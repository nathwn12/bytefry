using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace MemeFryer.Desktop;

/// <summary>
/// Off-screen verification of the shipped host: run with <c>Bytefry.exe --selfcheck &lt;report.json&gt;</c>.
/// It exercises the real WebView2 environment, virtual host, injected bridge, message round trip and a
/// real file write. The window is positioned outside every monitor, out of the taskbar and never
/// activated, so nothing is visible and no focus is taken — but a window still exists, so this is
/// off-screen verification, not headless rendering. Exit 0 = pass, 1 = fail, 2 = app bundle missing.
/// </summary>
internal static class SelfCheck
{
    private const string PixelDataUrl =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    private const string ProbeSlot = "__memeFryerProbe";
    private const string WriteSlot = "__memeFryerWrite";

    /// <summary>The script stores this before it has an answer; it is never a result.</summary>
    private const string PendingSentinel = "pending";

    private static readonly JsonSerializerOptions ReportJson = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    internal static async Task<int> RunAsync(CoreWebView2 core, MainForm host, string reportPath, string appDir)
    {
        var checks = new List<Check>();
        ChromeResult? chrome = null;

        try
        {
            // The window exists (WebView2 needs a real HWND) but must not be on any monitor.
            var bounds = host.Bounds;
            var onScreen = Screen.AllScreens.Any(screen => screen.Bounds.IntersectsWith(bounds));

            Add(checks, "self-check window is off every monitor", !onScreen,
                $"{bounds.X},{bounds.Y} {bounds.Width}x{bounds.Height}");
            Add(checks, "self-check window stays out of the taskbar", !host.ShowInTaskbar,
                host.ShowInTaskbar ? "shown in taskbar" : "out of taskbar");

            // The caption is Windows' own, and these style bits are what make it Windows': the drag
            // region, the system menu, the buttons and the resize border. A custom title bar is
            // exactly what would drop them, so their absence is a failure, not a style choice.
            var absent = WindowChrome.MissingCaptionStyles(host.Handle);
            Add(checks, "the window keeps its native caption, system menu and system buttons",
                absent.Count == 0,
                absent.Count == 0 ? "caption, system menu, minimise, maximise and resize border present"
                                  : "missing: " + string.Join(", ", absent));

            // Read the decision the shipping path made at handle creation, not a fresh one.
            chrome = host.Chrome;
            Add(checks, "the caption colours were asked for through DWM", chrome is not null,
                chrome?.Plan.Reason ?? "no decision was recorded: the window was never themed");

            if (chrome is not null)
            {
                if (chrome.Plan.DarkTitleBar)
                {
                    Add(checks, "DWM accepted the dark title bar",
                        chrome.DarkModeAccepted && chrome.DarkModeObserved != 0,
                        $"{chrome.Detail}; read back {chrome.DarkModeObserved?.ToString() ?? "(not queryable)"}");
                }
                else
                {
                    // A build too old for the attribute, or high contrast: leaving the caption alone is
                    // the intended result there, and the reason says which.
                    Add(checks, "the title bar was left to the system theme", true, chrome.Plan.Reason);
                }

                if (chrome.Plan.SupportsCaptionColor)
                    Add(checks, "DWM accepted the caption colors", chrome.CaptionAccepted, chrome.Detail);

                // Windows gives every new HWND the default caption, and the form asks again on each
                // HandleCreated. Making the same call twice is therefore the shipping behaviour; it
                // must be safe and must leave the caption where the first call put it.
                var again = WindowChrome.Apply(host.Handle);
                Add(checks, "the caption can be applied again without changing it",
                    again.Plan == chrome.Plan && (!again.Plan.DarkTitleBar || again.DarkModeObserved != 0),
                    again.Detail);
            }

            using var probe = await RunScriptAsync(core, ProbeSlot, ProbeSlotScript, TimeSpan.FromSeconds(20));
            var p = probe.RootElement;

            Add(checks, "page origin is the local virtual host",
                Str(p, "origin") == $"https://{AppPaths.VirtualHost}",
                Str(p, "origin") ?? "(none)");
            Add(checks, "app/index.html was served",
                Str(p, "url")?.EndsWith("/index.html", StringComparison.Ordinal) == true,
                Str(p, "url") ?? "(none)");
            Add(checks, "document has a title", !string.IsNullOrWhiteSpace(Str(p, "title")),
                Str(p, "title") ?? "(empty)");
            Add(checks, "window.fryerHost is injected", Str(p, "fryerHost") == "object",
                Str(p, "fryerHost") ?? "(missing)");
            Add(checks, "bridge reports available",
                p.TryGetProperty("available", out var available) && available.ValueKind == JsonValueKind.True,
                p.TryGetProperty("available", out var available2) ? available2.ToString() : "(missing)");
            Add(checks, "bridge version is 1",
                p.TryGetProperty("version", out var version) && version.ValueKind == JsonValueKind.Number && version.GetInt32() == 1,
                p.TryGetProperty("version", out var version2) ? version2.ToString() : "(missing)");

            if (p.TryGetProperty("hostInfo", out var info) && info.ValueKind == JsonValueKind.Object)
            {
                Add(checks, "hostInfo round trip: host name",
                    Str(info, "host") == "meme-fryer-desktop", Str(info, "host") ?? "(none)");
                Add(checks, "hostInfo round trip: bridge protocol",
                    info.TryGetProperty("bridge", out var bridge) && bridge.GetInt32() == 1,
                    info.TryGetProperty("bridge", out var bridge2) ? bridge2.ToString() : "(none)");
                Add(checks, "hostInfo reports the resolved app folder",
                    string.Equals(Str(info, "appDir"), appDir, StringComparison.OrdinalIgnoreCase),
                    Str(info, "appDir") ?? "(none)");
                Add(checks, "hostInfo reports the WebView2 runtime",
                    !string.IsNullOrWhiteSpace(Str(info, "browserVersion")),
                    Str(info, "browserVersion") ?? "(none)");
                Add(checks, "hostInfo reports the user data folder",
                    !string.IsNullOrWhiteSpace(Str(info, "userDataDir")),
                    Str(info, "userDataDir") ?? "(none)");
            }
            else
            {
                Add(checks, "hostInfo round trip", false, Str(p, "hostInfoError") ?? "(no reply)");
            }

            // A name that cannot already exist: the check never deletes or overwrites anything of the user's.
            var directory = Path.GetDirectoryName(Path.GetFullPath(reportPath)) ?? Path.GetTempPath();
            var targetPath = Path.Combine(directory, $"selfcheck-write-{Guid.NewGuid():N}.png");

            using var write = await RunScriptAsync(core, WriteSlot, WriteScript(targetPath), TimeSpan.FromSeconds(20));
            var wrote = write.RootElement.TryGetProperty("ok", out var okFlag) && okFlag.ValueKind == JsonValueKind.True;

            Add(checks, "saveImage writes a file",
                wrote && File.Exists(targetPath),
                wrote ? targetPath : Str(write.RootElement, "error") ?? "(no reply)");

            if (File.Exists(targetPath))
            {
                var size = new FileInfo(targetPath).Length;
                Add(checks, "written bytes match the payload", size == 70, $"{size} bytes");
                File.Delete(targetPath);
            }
        }
        catch (Exception ex)
        {
            Add(checks, "self-check completed", false, $"{ex.GetType().Name}: {ex.Message}");
        }

        var passed = checks.Count > 0 && checks.All(c => c.Ok);
        await WriteReportAsync(reportPath, new
        {
            host = "meme-fryer-desktop",
            selfCheckVersion = 1,
            appDir,
            window = new
            {
                x = host.Bounds.X,
                y = host.Bounds.Y,
                width = host.Bounds.Width,
                height = host.Bounds.Height,
                showInTaskbar = host.ShowInTaskbar,
                onScreen = Screen.AllScreens.Any(screen => screen.Bounds.IntersectsWith(host.Bounds)),
            },
            chrome = chrome is null
                ? null
                : new
                {
                    reason = chrome.Plan.Reason,
                    darkTitleBar = chrome.Plan.DarkTitleBar,
                    captionColor = chrome.Plan.CaptionColor?.ToArgb().ToString("X8"),
                    captionTextColor = chrome.Plan.CaptionTextColor?.ToArgb().ToString("X8"),
                    darkModeObserved = chrome.DarkModeObserved,
                    accepted = chrome.DarkModeAccepted && chrome.CaptionAccepted,
                    detail = chrome.Detail,
                },
            at = DateTimeOffset.UtcNow,
            passed,
            checks,
        });

        return passed ? 0 : 1;
    }

    /// <summary>Writes a red report when the run dies before it can reach a verdict.</summary>
    internal static async Task WriteFailureAsync(string reportPath, string appDir, string reason, Exception? error)
    {
        try
        {
            await WriteReportAsync(reportPath, new
            {
                host = "meme-fryer-desktop",
                selfCheckVersion = 1,
                appDir,
                window = (object?)null,
                at = DateTimeOffset.UtcNow,
                passed = false,
                checks = new[]
                {
                    new Check(reason, false, error is null ? reason : $"{error.GetType().Name}: {error.Message}"),
                },
            });

            try { Console.Out.WriteLine($"[meme-fryer] wrote failure report: {reportPath}"); }
            catch (IOException) { /* no console attached */ }
        }
        catch (Exception ex)
        {
            // A report that cannot be written must not mask the original failure.
            try { Console.Error.WriteLine($"[meme-fryer] could not write the failure report: {ex.Message}"); }
            catch (IOException) { /* no console attached */ }
        }
    }

    private static async Task WriteReportAsync(string reportPath, object report)
    {
        var json = JsonSerializer.Serialize(report, ReportJson);
        var directory = Path.GetDirectoryName(Path.GetFullPath(reportPath));
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
        await File.WriteAllTextAsync(reportPath, json, new UTF8Encoding(false));
    }

    /// <summary>
    /// ExecuteScriptAsync returns the immediate value of the expression, so a promise comes back as
    /// <c>{}</c>. The script therefore stores its result on a window slot and the host polls for it,
    /// skipping the "pending" sentinel it writes first.
    /// </summary>
    private static async Task<JsonDocument> RunScriptAsync(
        CoreWebView2 core, string slot, string script, TimeSpan timeout)
    {
        await core.ExecuteScriptAsync(script.Replace("__SLOT__", slot, StringComparison.Ordinal));

        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            var raw = await core.ExecuteScriptAsync($"window.{slot} ?? null");

            if (raw is "" or "null")
            {
                await Task.Delay(50);
                continue;
            }

            if (raw[0] != '"')
                throw new InvalidOperationException($"unexpected script result from the page: {Truncate(raw)}");

            var text = JsonSerializer.Deserialize<string>(raw);
            if (string.IsNullOrEmpty(text) || text == PendingSentinel)
            {
                await Task.Delay(50);
                continue;
            }

            await core.ExecuteScriptAsync($"window.{slot} = null");
            return JsonDocument.Parse(text);
        }

        throw new TimeoutException($"the page did not answer within {timeout.TotalSeconds:0}s ({slot})");
    }

    private static string Truncate(string value) =>
        value.Length <= 120 ? value : value[..120] + "…";

    private static void Add(List<Check> checks, string name, bool ok, string detail) =>
        checks.Add(new Check(name, ok, detail));

    private static string? Str(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private const string ProbeSlotScript = """
        (() => {
          window.__SLOT__ = 'pending';
          (async () => {
            const report = {
              url: location.href,
              origin: location.origin,
              title: document.title,
              fryerHost: typeof window.fryerHost,
              available: !!(window.fryerHost && window.fryerHost.available),
              version: window.fryerHost ? window.fryerHost.version : null,
            };
            try { report.hostInfo = await window.fryerHost.hostInfo(); }
            catch (e) { report.hostInfoError = String((e && e.message) || e); }
            window.__SLOT__ = JSON.stringify(report);
          })().catch((e) => { window.__SLOT__ = JSON.stringify({ error: String((e && e.message) || e) }); });
        })()
        """;

    private static string WriteScript(string targetPath)
    {
        var quotedPath = JsonSerializer.Serialize(targetPath);
        return $$"""
            (() => {
              window.__SLOT__ = 'pending';
              (async () => {
                try {
                  const saved = await window.fryerHost.saveImage({
                    dataUrl: '{{PixelDataUrl}}',
                    path: {{quotedPath}},
                  });
                  window.__SLOT__ = JSON.stringify({ ok: true, saved });
                } catch (e) {
                  window.__SLOT__ = JSON.stringify({ ok: false, error: String((e && e.message) || e) });
                }
              })();
            })()
            """;
    }

    private sealed record Check(string Name, bool Ok, string Detail);
}
