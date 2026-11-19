using System.Diagnostics;
using System.Text;

namespace MemeFryer.Desktop.Tests;

/// <summary>Tiny assertion runner: no widget is ever created, so the whole suite is window-free.</summary>
internal sealed class Runner
{
    private readonly List<string> _failures = new();
    private readonly List<string> _skips = new();
    private int _passed;

    internal int Passed => _passed;
    internal IReadOnlyList<string> Failures => _failures;
    internal IReadOnlyList<string> Skips => _skips;

    internal void Check(string name, Action body)
    {
        try
        {
            body();
            _passed++;
            Console.WriteLine($"  ok    {name}");
        }
        catch (Exception ex)
        {
            var message = ex is CheckFailed ? ex.Message : $"{ex.GetType().Name}: {ex.Message}";
            _failures.Add($"{name}: {message}");
            Console.WriteLine($"  FAIL  {name}");
            Console.WriteLine($"        {message}");
        }
    }

    internal void Skip(string name, string reason)
    {
        _skips.Add($"{name} ({reason})");
        Console.WriteLine($"  skip  {name} - {reason}");
    }

    internal static void Require(bool condition, string message)
    {
        if (!condition) throw new CheckFailed(message);
    }

    internal static void RequireEqual<T>(T expected, T actual, string what)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new CheckFailed($"{what}: expected {expected}, got {actual}");
    }

    private sealed class CheckFailed(string message) : Exception(message);
}

/// <summary>Runs the injected bridge script in Node with a fake <c>chrome.webview</c>; no browser, no window.</summary>
internal sealed class NodeBridge
{
    private readonly string _nodePath;
    internal NodeBridge()
    {
        _nodePath = ResolveNode() ?? string.Empty;
    }

    internal bool Available => _nodePath.Length > 0;
    internal string NodePath => _nodePath;

    /// <summary>Returns the per-assertion results, or throws with Node's stderr when it fails.</summary>
    internal List<(string Name, bool Ok, string Detail)> Run(string script, string workDir)
    {
        var scriptPath = Path.Combine(workDir, "bridge-script.js");
        var harnessPath = Path.Combine(workDir, "harness.mjs");
        File.WriteAllText(scriptPath, script, new UTF8Encoding(false));
        File.WriteAllText(harnessPath, Harness, new UTF8Encoding(false));

        var start = new ProcessStartInfo(_nodePath)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            WorkingDirectory = workDir,
        };
        start.ArgumentList.Add(harnessPath);
        start.ArgumentList.Add(scriptPath);

        using var process = Process.Start(start) ?? throw new InvalidOperationException("node did not start");
        var stdout = process.StandardOutput.ReadToEnd();
        var stderr = process.StandardError.ReadToEnd();
        process.WaitForExit(60_000);

        if (process.ExitCode != 0)
            throw new InvalidOperationException($"node exited {process.ExitCode}: {stderr.Trim()} {stdout.Trim()}");

        using var document = System.Text.Json.JsonDocument.Parse(stdout);
        var results = new List<(string, bool, string)>();
        foreach (var item in document.RootElement.GetProperty("results").EnumerateArray())
        {
            results.Add((
                item.GetProperty("name").GetString() ?? "(unnamed)",
                item.GetProperty("ok").GetBoolean(),
                item.TryGetProperty("detail", out var detail) ? detail.ToString() : string.Empty));
        }

        return results;
    }

    /// <summary>Syntax check only: <c>node --check</c> parses the script without running it.</summary>
    internal void SyntaxCheck(string script, string workDir)
    {
        var path = Path.Combine(workDir, "bridge-script-syntax.js");
        File.WriteAllText(path, script, new UTF8Encoding(false));

        var start = new ProcessStartInfo(_nodePath)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            WorkingDirectory = workDir,
        };
        start.ArgumentList.Add("--check");
        start.ArgumentList.Add(path);

        using var process = Process.Start(start) ?? throw new InvalidOperationException("node did not start");
        var stderr = process.StandardError.ReadToEnd();
        process.WaitForExit(30_000);

        if (process.ExitCode != 0)
            throw new InvalidOperationException($"node --check failed: {stderr.Trim()}");
    }

    private static string? ResolveNode()
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (var directory in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            var candidate = Path.Combine(directory.Trim(), "node.exe");
            if (File.Exists(candidate)) return candidate;
        }

        return null;
    }

    private const string Harness = """
        import vm from 'node:vm';
        import fs from 'node:fs';

        const source = fs.readFileSync(process.argv[2], 'utf8');
        const results = [];
        const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });

        const dispatched = [];
        const makeWindow = () => ({ dispatchEvent: (event) => { dispatched.push(event.type); return true; } });

        globalThis.window = makeWindow();
        vm.runInThisContext(source, { filename: 'bridge-script.js' });
        check('browser fallback exposes available:false', globalThis.window.fryerHost && globalThis.window.fryerHost.available === false,
          globalThis.window.fryerHost && globalThis.window.fryerHost.available);
        check('browser fallback keeps the member surface', ['openImage', 'saveImage', 'copyImage', 'hostInfo']
          .every((name) => typeof globalThis.window.fryerHost[name] === 'function'));
        let threw = false;
        try { await globalThis.window.fryerHost.saveImage({ dataUrl: 'x' }); } catch { threw = true; }
        check('browser fallback saveImage rejects', threw);

        const listeners = [];
        const sent = [];
        const webview = {
          addEventListener: (name, fn) => listeners.push(fn),
          postMessage: (message) => {
            sent.push(message);
            const reply = { id: message.id, ok: !(message.args && message.args.fail) };
            if (reply.ok) reply.result = { command: message.command, args: message.args, id: message.id };
            else reply.error = 'host refused: ' + message.command;
            queueMicrotask(() => listeners.forEach((fn) => fn({ data: reply })));
          },
        };
        globalThis.window = makeWindow();
        globalThis.window.chrome = { webview };
        vm.runInThisContext(source, { filename: 'bridge-script.js' });

        check('the ready event is dispatched in both branches', dispatched.filter((t) => t === 'fryerhostready').length === 2,
          dispatched.join(','));

        const host = globalThis.window.fryerHost;
        check('host branch reports available and version 1', host.available === true && host.version === 1, host.available + '/' + host.version);

        const info = await host.hostInfo();
        check('a reply resolves the matching promise', info && info.command === 'hostInfo', JSON.stringify(info));
        check('the request carries a numeric id and the command', typeof sent[0].id === 'number' && sent[0].command === 'hostInfo', JSON.stringify(sent[0]));

        const both = await Promise.all([host.openImage({ title: 'a' }), host.saveImage({ dataUrl: 'x' })]);
        check('concurrent calls keep their own answers',
          both[0].command === 'openImage' && both[1].command === 'saveImage' && sent[1].id !== sent[2].id,
          sent.map((m) => m.command + ':' + m.id).join(','));

        let rejection = '';
        try { await host.saveImage({ dataUrl: 'x', fail: true }); } catch (e) { rejection = e.message; }
        check('an error reply rejects with the host message', rejection.indexOf('host refused: saveImage') === 0, rejection);

        listeners.forEach((fn) => fn({ data: { id: 9999, ok: true, result: null } }));
        check('an unknown reply id is ignored', true);
        listeners.forEach((fn) => fn({ data: 'not an object' }));
        listeners.forEach((fn) => fn({ data: { ok: true } }));
        check('a malformed reply is ignored', true);

        console.log(JSON.stringify({ results }));
        """;
}
