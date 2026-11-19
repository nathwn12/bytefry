using System.Diagnostics;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using MemeFryer.Desktop;

namespace MemeFryer.Desktop.Tests;

/// <summary>
/// Window-free checks for the desktop host. Nothing here creates a Form, a WebView2 or a message box:
/// the bridge is driven directly, the injected script is exercised in Node against a fake
/// <c>chrome.webview</c>, and packaging invariants are read from the build files.
/// </summary>
internal static class Program
{
    private const string PixelPng =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    private static int Main()
    {
        var runner = new Runner();
        var tempRoot = Path.Combine(Path.GetTempPath(), $"meme-fryer-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempRoot);

        try
        {
            Console.WriteLine("app folder resolution");
            AppPathChecks(runner, tempRoot);

            Console.WriteLine("bridge host (no dialogs)");
            BridgeChecks(runner, tempRoot);

            Console.WriteLine("self-check report writer");
            ReportChecks(runner, tempRoot);

            Console.WriteLine("injected bridge script");
            ScriptChecks(runner, tempRoot);

            Console.WriteLine("packaging invariants");
            PackagingChecks(runner);

            Console.WriteLine("native title bar");
            ChromeChecks(runner);

            Console.WriteLine("window and installer icon");
            IconChecks(runner);

            Console.WriteLine("command line (no window)");
            CommandLineChecks(runner, tempRoot);
        }
        finally
        {
            try { Directory.Delete(tempRoot, recursive: true); } catch (IOException) { /* best effort */ }
        }

        Console.WriteLine();
        Console.WriteLine($"{runner.Passed} passed, {runner.Failures.Count} failed, {runner.Skips.Count} skipped");
        foreach (var skip in runner.Skips) Console.WriteLine($"  skip  {skip}");
        foreach (var failure in runner.Failures) Console.WriteLine($"  FAIL  {failure}");

        return runner.Failures.Count == 0 ? 0 : 1;
    }


    private static void AppPathChecks(Runner runner, string tempRoot)
    {
        var saved = Environment.GetEnvironmentVariable("MEME_FRYER_APP_DIR");
        try
        {
            runner.Check("MEME_FRYER_APP_DIR wins when it holds index.html", () =>
            {
                var envApp = Path.Combine(tempRoot, "env-app");
                Directory.CreateDirectory(envApp);
                File.WriteAllText(Path.Combine(envApp, "index.html"), "<!doctype html>");
                Environment.SetEnvironmentVariable("MEME_FRYER_APP_DIR", envApp);

                var resolved = AppPaths.ResolveAppDir(tempRoot);
                Runner.RequireEqual(Path.GetFullPath(envApp), Path.GetFullPath(resolved), "resolved app folder");
            });

            runner.Check("app/ beside the start folder is found without the environment", () =>
            {
                Environment.SetEnvironmentVariable("MEME_FRYER_APP_DIR", null);
                var exeDir = Path.Combine(tempRoot, "portable");
                var appDir = Path.Combine(exeDir, "app");
                Directory.CreateDirectory(appDir);
                File.WriteAllText(Path.Combine(appDir, "index.html"), "<!doctype html>");

                var resolved = AppPaths.ResolveAppDir(exeDir);
                Runner.RequireEqual(Path.GetFullPath(appDir), Path.GetFullPath(resolved), "resolved app folder");
            });

            runner.Check("the source layout app/ beside desktop/ is found by walking up", () =>
            {
                Environment.SetEnvironmentVariable("MEME_FRYER_APP_DIR", null);
                var repo = Path.Combine(tempRoot, "repo");
                var deep = Path.Combine(repo, "desktop", "src", "bin", "Debug", "net10.0-windows");
                Directory.CreateDirectory(deep);
                Directory.CreateDirectory(Path.Combine(repo, "app"));
                File.WriteAllText(Path.Combine(repo, "app", "index.html"), "<!doctype html>");

                var resolved = AppPaths.ResolveAppDir(deep);
                Runner.RequireEqual(Path.GetFullPath(Path.Combine(repo, "app")), Path.GetFullPath(resolved), "resolved app folder");
            });

            runner.Check("a missing bundle fails with every searched path listed", () =>
            {
                Environment.SetEnvironmentVariable("MEME_FRYER_APP_DIR", null);
                var lonely = Path.Combine(tempRoot, "lonely");
                Directory.CreateDirectory(lonely);

                try
                {
                    AppPaths.ResolveAppDir(lonely);
                    throw new InvalidOperationException("ResolveAppDir should have thrown");
                }
                catch (DirectoryNotFoundException ex)
                {
                    Runner.Require(ex.Message.Contains(Path.Combine(lonely, "app"), StringComparison.OrdinalIgnoreCase),
                        "the beside-the-exe candidate is not named in the message");
                    Runner.Require(ex.Message.Contains("MEME_FRYER_APP_DIR", StringComparison.Ordinal),
                        "the environment override is not named in the message");
                }
            });

            runner.Check("the walk up stops after six levels", () =>
            {
                Environment.SetEnvironmentVariable("MEME_FRYER_APP_DIR", null);
                var repo = Path.Combine(tempRoot, "deep-repo");
                var leaf = repo;
                for (var i = 0; i < 8; i++) leaf = Path.Combine(leaf, $"level{i}");
                Directory.CreateDirectory(leaf);
                Directory.CreateDirectory(Path.Combine(repo, "desktop"));
                Directory.CreateDirectory(Path.Combine(repo, "app"));
                File.WriteAllText(Path.Combine(repo, "app", "index.html"), "<!doctype html>");

                try
                {
                    var resolved = AppPaths.ResolveAppDir(leaf);
                    throw new InvalidOperationException($"walk up should have stopped, but resolved {resolved}");
                }
                catch (DirectoryNotFoundException)
                {
                    // expected: the repo root is out of reach
                }
            });

            runner.Check("MEME_FRYER_USER_DATA_DIR is created and used", () =>
            {
                var dataDir = Path.Combine(tempRoot, "profile", "WebView2");
                var savedData = Environment.GetEnvironmentVariable("MEME_FRYER_USER_DATA_DIR");
                try
                {
                    Environment.SetEnvironmentVariable("MEME_FRYER_USER_DATA_DIR", dataDir);
                    var resolved = AppPaths.ResolveUserDataDir();
                    Runner.RequireEqual(Path.GetFullPath(dataDir), Path.GetFullPath(resolved), "user data folder");
                    Runner.Require(Directory.Exists(dataDir), "the user data folder was not created");
                }
                finally
                {
                    Environment.SetEnvironmentVariable("MEME_FRYER_USER_DATA_DIR", savedData);
                }
            });
        }
        finally
        {
            Environment.SetEnvironmentVariable("MEME_FRYER_APP_DIR", saved);
        }
    }


    private static void BridgeChecks(Runner runner, string tempRoot)
    {
        var appDir = Path.Combine(tempRoot, "app-for-bridge");
        Directory.CreateDirectory(appDir);
        var bridge = new Bridge(new NoWindow(), appDir, Path.Combine(tempRoot, "profile"), dev: false, () => "test-browser");
        var outDir = Path.Combine(tempRoot, "out");
        Directory.CreateDirectory(outDir);

        runner.Check("hostInfo answers with the v1 surface", () =>
        {
            var reply = Call(bridge, "hostInfo");
            Require(reply, "ok");
            var result = reply.GetProperty("result");
            Runner.RequireEqual("meme-fryer-desktop", result.GetProperty("host").GetString(), "host");
            Runner.RequireEqual(1, result.GetProperty("bridge").GetInt32(), "bridge");
            Runner.RequireEqual($"https://{AppPaths.VirtualHost}", result.GetProperty("origin").GetString(), "origin");
        });

        runner.Check("saveImage writes a data URL to an explicit path", () =>
        {
            var target = Path.Combine(outDir, "written.png");
            var reply = Call(bridge, "saveImage", new { dataUrl = $"data:image/png;base64,{PixelPng}", path = target });
            Require(reply, "ok");

            Runner.Require(File.Exists(target), "the file was not written");
            Runner.RequireEqual(70L, new FileInfo(target).Length, "written bytes");
            Runner.RequireEqual("image/png", reply.GetProperty("result").GetProperty("mime").GetString(), "mime");
        });

        runner.Check("saveImage accepts bare base64 with a declared mime", () =>
        {
            var target = Path.Combine(outDir, "base64.jpg");
            var reply = Call(bridge, "saveImage", new { @base64 = PixelPng, mime = "image/jpeg", path = target });
            Require(reply, "ok");
            Runner.RequireEqual("image/jpeg", reply.GetProperty("result").GetProperty("mime").GetString(), "mime");
            Runner.Require(File.Exists(target), "the file was not written");
        });

        runner.Check("saveImage tolerates a charset parameter and wrapped base64", () =>
        {
            var target = Path.Combine(outDir, "charset.png");
            var wrapped = PixelPng.Insert(20, "\r\n").Insert(40, " ");
            var reply = Call(bridge, "saveImage", new
            {
                dataUrl = $"data:image/png;charset=utf-8;base64,{wrapped}",
                path = target,
            });
            Require(reply, "ok");
            Runner.Require(File.Exists(target), "the file was not written");
            Runner.RequireEqual(70L, new FileInfo(target).Length, "written bytes");
        });

        runner.Check("saveImage creates the missing directories of an explicit path", () =>
        {
            var target = Path.Combine(outDir, "a", "b", "c", "nested.png");
            var reply = Call(bridge, "saveImage", new { dataUrl = $"data:image/png;base64,{PixelPng}", path = target });
            Require(reply, "ok");
            Runner.Require(File.Exists(target), "the nested file was not written");
        });

        runner.Check("saveImage reports a write it cannot do instead of throwing at the page", () =>
        {
            var blocker = Path.Combine(outDir, "blocker");
            File.WriteAllText(blocker, "not a directory");
            var reply = Call(bridge, "saveImage", new
            {
                dataUrl = $"data:image/png;base64,{PixelPng}",
                path = Path.Combine(blocker, "child.png"),
            });
            Runner.Require(reply.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.False, "the reply is not a failure");
            Runner.Require(reply.GetProperty("error").GetString()?.Length > 0, "the failure carries no message");
        });

        runner.Check("saveImage refuses a payload it cannot decode", () =>
        {
            var reply = Call(bridge, "saveImage", new { path = Path.Combine(outDir, "never.png") });
            Runner.Require(reply.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.False, "the reply is not a failure");
            Runner.Require(reply.GetProperty("error").GetString()?.Contains("dataUrl", StringComparison.OrdinalIgnoreCase) == true,
                "the failure does not name the missing payload");
        });

        runner.Check("an unknown command is rejected, not silently ignored", () =>
        {
            var reply = Call(bridge, "explode");
            Runner.Require(reply.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.False, "the reply is not a failure");
            Runner.Require(reply.GetProperty("error").GetString()?.Contains("unknown command", StringComparison.Ordinal) == true,
                "the failure does not name the unknown command");
        });

        runner.Check("a malformed message gets no reply", () =>
        {
            Runner.Require(bridge.HandleAsync("{not json").GetAwaiter().GetResult() is null, "a reply was produced");
            Runner.Require(bridge.HandleAsync("[]").GetAwaiter().GetResult() is null, "a reply was produced");
        });

        runner.Check("a message without a numeric id gets no reply", () =>
        {
            Runner.Require(bridge.HandleAsync("""{"command":"hostInfo","args":{}}""").GetAwaiter().GetResult() is null,
                "a reply was produced");
            Runner.Require(bridge.HandleAsync("""{"id":"7","command":"hostInfo"}""").GetAwaiter().GetResult() is null,
                "a string id was accepted");
        });

        runner.Check("the reply echoes the request id", () =>
        {
            var reply = Call(bridge, "hostInfo", new { }, id: 41.5);
            Runner.RequireEqual(41.5, reply.GetProperty("id").GetDouble(), "id");
        });


        runner.Check("a destination that appears during the save is never replaced", () =>
        {
            var dir = Path.Combine(tempRoot, "atomic-race");
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, "racer.png");

            // The save is told the name is free (as the dialog was), then another program wins the
            // name before the rename. Replacing it would overwrite a file the user never confirmed.
            var error = string.Empty;
            try
            {
                AtomicSave.SaveAsync(target, new byte[] { 7, 7, 7 }, AtomicSave.Observe(target), (stream, bytes) =>
                {
                    File.WriteAllText(target, "another program's file");
                    return stream.WriteAsync(bytes, 0, bytes.Length);
                }).GetAwaiter().GetResult();

                throw new InvalidOperationException("the save replaced a file that appeared after the name was chosen");
            }
            catch (IOException ex)
            {
                error = ex.Message;
            }

            Runner.Require(error.Contains("appeared", StringComparison.Ordinal),
                $"the refusal does not say the file appeared: {error}");
            Runner.RequireEqual("another program's file", File.ReadAllText(target),
                "the file that appeared during the save was replaced");
            Runner.RequireEqual(0, Directory.GetFiles(dir, AtomicSave.TempPrefix + "*" + AtomicSave.TempSuffix).Length,
                "temporary files left behind");
        });

        runner.Check("a save to a free name creates it and leaves nothing else behind", () =>
        {
            var dir = Path.Combine(tempRoot, "atomic-new");
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, "fresh.png");

            var saved = AtomicSave.SaveAsync(target, new byte[] { 1, 2, 3 }, AtomicSave.Observe(target))
                .GetAwaiter().GetResult();

            Runner.RequireEqual(Path.GetFullPath(target), saved, "returned path");
            Runner.Require(File.ReadAllBytes(target).SequenceEqual(new byte[] { 1, 2, 3 }), "the bytes were not written");
            var names = Directory.GetFiles(dir).Select(Path.GetFileName).ToArray();
            Runner.Require(names.SequenceEqual(new[] { "fresh.png" }),
                $"the folder holds: {string.Join(", ", names)}");
        });

        runner.Check("a failing save to a free name leaves neither a file nor a temporary", () =>
        {
            var dir = Path.Combine(tempRoot, "atomic-new-fail");
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, "never.png");

            var message = string.Empty;
            try
            {
                AtomicSave.SaveAsync(target, new byte[2048], AtomicSave.Observe(target), (stream, bytes) =>
                {
                    stream.Write(bytes, 0, 16);
                    throw new IOException("simulated disk full");
                }).GetAwaiter().GetResult();

                throw new InvalidOperationException("the save reported success");
            }
            catch (IOException ex)
            {
                message = ex.Message;
            }

            Runner.Require(message.Contains("was not changed", StringComparison.Ordinal),
                $"the failure does not say the destination was left alone: {message}");
            Runner.Require(!File.Exists(target), "a half-written file was left at the destination");
            Runner.RequireEqual(0, Directory.GetFiles(dir).Length, "files left in the folder");
        });

        runner.Check("a replacement keeps the destination's own metadata", () =>
        {
            var dir = Path.Combine(tempRoot, "atomic-metadata");
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, "marked.png");
            File.WriteAllBytes(target, new byte[] { 0, 0 });
            File.SetAttributes(target, FileAttributes.NotContentIndexed);

            try
            {
                AtomicSave.SaveAsync(target, new byte[] { 5, 5, 5, 5 }, AtomicSave.Observe(target))
                    .GetAwaiter().GetResult();

                Runner.Require(File.ReadAllBytes(target).SequenceEqual(new byte[] { 5, 5, 5, 5 }),
                    "the bytes were not replaced");
                Runner.Require(File.GetAttributes(target).HasFlag(FileAttributes.NotContentIndexed),
                    "the destination's own attribute was dropped by the replacement");
            }
            finally
            {
                try { File.SetAttributes(target, FileAttributes.Normal); } catch (IOException) { }
            }

            Runner.RequireEqual(0, Directory.GetFiles(dir, AtomicSave.TempPrefix + "*" + AtomicSave.TempSuffix).Length,
                "temporary files left behind");
        });

        runner.Check("a destination that refuses the replacement fails closed", () =>        {
            var dir = Path.Combine(tempRoot, "atomic-readonly");
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, "readonly.png");
            var original = new byte[] { 3, 3, 3 };
            File.WriteAllBytes(target, original);
            File.SetAttributes(target, FileAttributes.ReadOnly);

            try
            {
                var reply = Call(bridge, "saveImage", new { dataUrl = $"data:image/png;base64,{PixelPng}", path = target });
                Runner.Require(reply.GetProperty("ok").ValueKind == JsonValueKind.False,
                    "the save reported success on a destination it could not replace");
                Runner.Require(reply.GetProperty("error").GetString()?.Contains("could not be replaced", StringComparison.Ordinal) == true,
                    "the failure did not come from the replacement: " + reply.GetProperty("error").GetString());
                Runner.Require(reply.GetProperty("error").GetString()?.Contains("was not changed", StringComparison.Ordinal) == true,
                    "the failure does not say the destination was left alone");
            }
            finally
            {
                File.SetAttributes(target, FileAttributes.Normal);
            }

            Runner.Require(File.ReadAllBytes(target).SequenceEqual(original), "the read-only file's bytes changed");
            Runner.RequireEqual(0, Directory.GetFiles(dir, AtomicSave.TempPrefix + "*" + AtomicSave.TempSuffix).Length,
                "temporary files left behind");
        });


        runner.Check("the staged file is readable only by the current user and SYSTEM", () =>
        {
            var dir = Path.Combine(tempRoot, "atomic-acl");
            Directory.CreateDirectory(dir);
            GrantEveryoneRead(dir);

            var target = Path.Combine(dir, "shared.png");
            var grantees = Array.Empty<string>();

            // The descriptor is read through the staging seam, before a single byte is written: the
            // exposure is the write window, not the commit.
            AtomicSave.SaveAsync(
                target,
                new byte[] { 1, 2, 3 },
                AtomicSave.Observe(target),
                staged: path => grantees = Grantees(path)).GetAwaiter().GetResult();

            var allowed = new[] { CurrentUserSid, SystemSid };
            var extra = grantees.Where(sid => !allowed.Contains(sid)).ToArray();
            Runner.Require(extra.Length == 0,
                $"the staged file also grants {string.Join(", ", extra)} (whole set: {string.Join(", ", grantees)})");
            Runner.Require(grantees.Contains(CurrentUserSid), "the staged file is not writable by its creator");
        });

        runner.Check("a newly created file gets its folder's permissions back", () =>
        {
            var dir = Path.Combine(tempRoot, "atomic-acl-inherit");
            Directory.CreateDirectory(dir);
            GrantEveryoneRead(dir);

            var target = Path.Combine(dir, "shared.png");
            AtomicSave.SaveAsync(target, new byte[] { 1, 2, 3 }, AtomicSave.Observe(target)).GetAwaiter().GetResult();

            var grantees = Grantees(target);
            Runner.Require(grantees.Contains(EveryoneSid),
                $"the saved file does not follow its folder's permissions: {string.Join(", ", grantees)}");
            Runner.Require(grantees.Contains(CurrentUserSid), "the saved file is not readable by its owner");
        });

        var asked = new List<string>();
        var answer = true;
        var guarded = new Bridge(
            new NoWindow(),
            appDir,
            Path.Combine(tempRoot, "profile-guarded"),
            dev: false,
            () => "test-browser",
            path =>
            {
                asked.Add(path);
                return answer;
            });

        runner.Check("a replacement the user declines writes nothing", () =>
        {
            var dir = Path.Combine(tempRoot, "atomic-declined");
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, "declined.png");
            var original = new byte[] { 1, 1, 1 };
            File.WriteAllBytes(target, original);

            asked.Clear();
            answer = false;
            var result = guarded.SaveToAsync(target, fromDialog: true, new byte[] { 9 }, "image/png")
                .GetAwaiter().GetResult();

            Runner.Require(result is null, "a declined replacement returned a result");
            Runner.RequireEqual(1, asked.Count, "confirmation prompts");
            Runner.RequireEqual(Path.GetFullPath(target), Path.GetFullPath(asked[0]), "the file the confirmation named");
            Runner.Require(File.ReadAllBytes(target).SequenceEqual(original),
                "the file changed although the replacement was declined");
            Runner.RequireEqual(0, Directory.GetFiles(dir, AtomicSave.TempPrefix + "*" + AtomicSave.TempSuffix).Length,
                "temporary files left behind");
        });

        runner.Check("a file that changes after the confirmation is not replaced", () =>
        {
            var dir = Path.Combine(tempRoot, "atomic-changed");
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, "changed.png");
            File.WriteAllBytes(target, new byte[] { 1, 1, 1 });

            asked.Clear();
            answer = true;
            var message = string.Empty;
            try
            {
                guarded.SaveToAsync(target, fromDialog: true, new byte[] { 9, 9, 9, 9 }, "image/png", (stream, bytes) =>
                {
                    File.WriteAllText(target, "edited after the user said replace");
                    return stream.WriteAsync(bytes, 0, bytes.Length);
                }).GetAwaiter().GetResult();

                throw new InvalidOperationException("the save replaced a file that had changed after confirmation");
            }
            catch (IOException ex)
            {
                message = ex.Message;
            }

            Runner.RequireEqual(1, asked.Count, "confirmation prompts");
            Runner.Require(message.Contains("changed after it was confirmed", StringComparison.Ordinal),
                $"the refusal does not say the file changed: {message}");
            Runner.RequireEqual("edited after the user said replace", File.ReadAllText(target),
                "the changed file was replaced anyway");
            Runner.RequireEqual(0, Directory.GetFiles(dir, AtomicSave.TempPrefix + "*" + AtomicSave.TempSuffix).Length,
                "temporary files left behind");
        });

        runner.Check("a file swapped for another at the same path is not replaced", () =>
        {
            var dir = Path.Combine(tempRoot, "atomic-swapped");
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, "swapped.png");
            File.WriteAllBytes(target, new byte[] { 1, 1, 1 });

            asked.Clear();
            answer = true;
            var message = string.Empty;
            try
            {
                guarded.SaveToAsync(target, fromDialog: true, new byte[] { 9, 9, 9, 9 }, "image/png", (stream, bytes) =>
                {
                    // Same name, different file: the confirmation named the one that was there.
                    File.Delete(target);
                    File.WriteAllBytes(target, new byte[] { 0xAA, 0xBB, 0xCC });
                    return stream.WriteAsync(bytes, 0, bytes.Length);
                }).GetAwaiter().GetResult();

                throw new InvalidOperationException("the save replaced a different file at the same path");
            }
            catch (IOException ex)
            {
                message = ex.Message;
            }

            Runner.Require(message.Contains("changed after it was confirmed", StringComparison.Ordinal),
                $"the refusal does not say the file changed: {message}");
            Runner.Require(File.ReadAllBytes(target).SequenceEqual(new byte[] { 0xAA, 0xBB, 0xCC }),
                "the file that replaced it was overwritten");
        });

        runner.Check("a confirmed, unchanged file is replaced", () =>
        {
            var dir = Path.Combine(tempRoot, "atomic-confirmed");
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, "confirmed.png");
            File.WriteAllBytes(target, new byte[] { 1, 1, 1 });

            asked.Clear();
            answer = true;
            var result = guarded.SaveToAsync(target, fromDialog: true, new byte[] { 5, 5 }, "image/png")
                .GetAwaiter().GetResult();

            Runner.Require(result is not null, "a confirmed replacement returned no result");
            Runner.RequireEqual(1, asked.Count, "confirmation prompts");
            Runner.Require(File.ReadAllBytes(target).SequenceEqual(new byte[] { 5, 5 }), "the file was not replaced");
        });

        runner.Check("an explicit path replaces without asking for a confirmation", () =>
        {
            var dir = Path.Combine(tempRoot, "atomic-explicit");
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, "explicit.png");
            File.WriteAllBytes(target, new byte[] { 1, 1, 1 });

            asked.Clear();
            var result = guarded.SaveToAsync(target, fromDialog: false, new byte[] { 6, 6 }, "image/png")
                .GetAwaiter().GetResult();

            Runner.Require(result is not null, "an explicit-path save returned no result");
            Runner.RequireEqual(0, asked.Count, "confirmation prompts for an explicit path");
            Runner.Require(File.ReadAllBytes(target).SequenceEqual(new byte[] { 6, 6 }), "the file was not replaced");
        });

        runner.Check("saveImage leaves an existing file intact when the save cannot complete", () =>
        {
            var dir = Path.Combine(tempRoot, "atomic-locked");
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, "locked.png");
            var original = new byte[] { 9, 8, 7, 6, 5 };
            File.WriteAllBytes(target, original);

            string error;
            using (new FileStream(target, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            {
                var reply = Call(bridge, "saveImage", new { dataUrl = $"data:image/png;base64,{PixelPng}", path = target });
                Runner.Require(reply.GetProperty("ok").ValueKind == JsonValueKind.False,
                    "the save reported success while the destination was locked by another handle");
                error = reply.GetProperty("error").GetString() ?? string.Empty;
            }

            Runner.Require(error.Contains("was not changed", StringComparison.Ordinal),
                $"the failure does not say the destination was left alone: {error}");
            Runner.Require(File.ReadAllBytes(target).SequenceEqual(original),
                "the previous bytes were replaced or truncated by a failed save");
            Runner.RequireEqual(0, Directory.GetFiles(dir, AtomicSave.TempPrefix + "*" + AtomicSave.TempSuffix).Length,
                "temporary files left behind");
        });

        runner.Check("a write that dies part way leaves the previous file and no temporary", () =>
        {
            var dir = Path.Combine(tempRoot, "atomic-partial");
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, "partial.png");
            var original = new byte[] { 4, 4, 4, 4, 4, 4, 4, 4 };
            File.WriteAllBytes(target, original);

            var wrote = 0;
            var message = string.Empty;
            try
            {
                AtomicSave.SaveAsync(target, new byte[4096], AtomicSave.Observe(target), (stream, bytes) =>
                {
                    // The new file now exists and is short: exactly the state the old in-place write
                    // left behind when it failed. The destination must not care.
                    stream.Write(bytes, 0, 4);
                    wrote = 4;
                    throw new IOException("simulated disk full");
                }).GetAwaiter().GetResult();

                throw new InvalidOperationException("the save reported success");
            }
            catch (IOException ex)
            {
                message = ex.Message;
            }

            Runner.RequireEqual(4, wrote, "the injected write ran before failing");
            Runner.Require(message.Contains("was not changed", StringComparison.Ordinal),
                $"the failure does not say the destination was left alone: {message}");
            Runner.Require(File.ReadAllBytes(target).SequenceEqual(original),
                "the previous bytes were lost to a failed write");
            Runner.RequireEqual(0, Directory.GetFiles(dir, AtomicSave.TempPrefix + "*" + AtomicSave.TempSuffix).Length,
                "temporary files left behind");
        });

        runner.Check("the new bytes are staged beside the destination, never in place", () =>
        {
            var dir = Path.Combine(tempRoot, "atomic-staging");
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, "staged.png");
            File.WriteAllBytes(target, new byte[] { 1 });

            string? staged = null;
            AtomicSave.SaveAsync(
                target,
                new byte[] { 2, 3, 4 },
                AtomicSave.Observe(target),
                staged: path => staged = path).GetAwaiter().GetResult();

            Runner.Require(staged is not null, "the temporary file was never reported");
            Runner.RequireEqual(Path.GetFullPath(dir), Path.GetDirectoryName(Path.GetFullPath(staged!))!,
                "temporary file directory");
            Runner.Require(Path.GetFileName(staged!) != Path.GetFileName(target),
                "the writer was handed the destination itself");
            Runner.Require(File.ReadAllBytes(target).SequenceEqual(new byte[] { 2, 3, 4 }),
                "the destination does not hold the new bytes");
            Runner.RequireEqual(0, Directory.GetFiles(dir, AtomicSave.TempPrefix + "*" + AtomicSave.TempSuffix).Length,
                "a completed save left a temporary file behind");
        });

        runner.Check("a save replaces an existing file and leaves its neighbours alone", () =>
        {
            var dir = Path.Combine(tempRoot, "atomic-replace");
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, "existing.png");
            File.WriteAllBytes(target, new byte[] { 0, 0, 0 });
            var neighbour = Path.Combine(dir, "notes.txt");
            File.WriteAllText(neighbour, "keep me");

            var reply = Call(bridge, "saveImage", new { dataUrl = $"data:image/png;base64,{PixelPng}", path = target });
            Require(reply, "ok");

            Runner.RequireEqual(70L, new FileInfo(target).Length, "replaced bytes");
            Runner.RequireEqual("keep me", File.ReadAllText(neighbour), "an unrelated file changed");
            var names = Directory.GetFiles(dir).Select(Path.GetFileName).OrderBy(name => name).ToArray();
            Runner.Require(names.SequenceEqual(new[] { "existing.png", "notes.txt" }),
                $"the folder holds: {string.Join(", ", names)}");
        });

        runner.Check("a save onto an existing folder is refused, never renamed over it", () =>
        {
            var dir = Path.Combine(tempRoot, "atomic-folder");
            Directory.CreateDirectory(dir);
            var folder = Path.Combine(dir, "picture.png");
            Directory.CreateDirectory(folder);

            var reply = Call(bridge, "saveImage", new { dataUrl = $"data:image/png;base64,{PixelPng}", path = folder });
            Runner.Require(reply.GetProperty("ok").ValueKind == JsonValueKind.False, "the save accepted a folder as its target");
            Runner.Require(reply.GetProperty("error").GetString()?.Contains("folder", StringComparison.OrdinalIgnoreCase) == true,
                "the failure does not name the folder");
            Runner.Require(Directory.Exists(folder), "the folder was replaced by a file");
        });
    }


    private static void ReportChecks(Runner runner, string tempRoot)
    {
        runner.Check("a failure report says passed:false and carries the reason", () =>
        {
            var path = Path.Combine(tempRoot, "reports", "failure.json");
            SelfCheck.WriteFailureAsync(path, Path.Combine(tempRoot, "app-for-bridge"), "the browser engine did not start",
                new InvalidOperationException("no runtime")).GetAwaiter().GetResult();

            using var document = JsonDocument.Parse(File.ReadAllText(path));
            var root = document.RootElement;
            Runner.Require(root.GetProperty("passed").ValueKind == JsonValueKind.False, "passed is not false");
            var checks = root.GetProperty("checks");
            Runner.RequireEqual(1, checks.GetArrayLength(), "check count");
            Runner.Require(checks[0].GetProperty("ok").ValueKind == JsonValueKind.False, "the check is not red");
            Runner.Require(checks[0].GetProperty("detail").GetString()?.Contains("no runtime", StringComparison.Ordinal) == true,
                "the exception message is missing from the report");
        });

        runner.Check("a report written to a missing directory creates it", () =>
        {
            var path = Path.Combine(tempRoot, "reports", "deeper", "still", "failure.json");
            SelfCheck.WriteFailureAsync(path, tempRoot, "reason", null).GetAwaiter().GetResult();
            Runner.Require(File.Exists(path), "the report was not written");
        });
    }


    private static void ScriptChecks(Runner runner, string tempRoot)
    {
        var script = BridgeScript.Source;
        var workDir = Path.Combine(tempRoot, "node");
        Directory.CreateDirectory(workDir);

        runner.Check("the script declares the v1 surface", () =>
        {
            foreach (var member in new[] { "openImage", "saveImage", "copyImage", "hostInfo" })
                Runner.Require(script.Contains(member, StringComparison.Ordinal), $"{member} is missing");
            Runner.Require(script.Contains("available: false", StringComparison.Ordinal) ||
                           script.Contains("available:false", StringComparison.Ordinal),
                "there is no browser fallback that reports available:false");
            Runner.Require(script.Contains("fryerhostready", StringComparison.Ordinal), "the ready event is missing");
        });

        var node = new NodeBridge();
        if (!node.Available)
        {
            runner.Skip("the injected script parses as JavaScript", "node not found on PATH");
            runner.Skip("the injected script behaves as a bridge", "node not found on PATH");
            return;
        }

        runner.Check("the injected script parses as JavaScript", () => node.SyntaxCheck(script, workDir));

        runner.Check("the injected script behaves as a bridge", () =>
        {
            var results = node.Run(script, workDir);
            Runner.Require(results.Count > 0, "the node harness reported nothing");
            var failures = results.Where(r => !r.Ok).ToList();
            Runner.Require(failures.Count == 0,
                string.Join("; ", failures.Select(f => $"{f.Name} ({f.Detail})")));
        });
    }


    private static void PackagingChecks(Runner runner)
    {
        var desktopDir = RepoPath("desktop");
        var csprojPath = Path.Combine(desktopDir, "MemeFryer.Desktop", "MemeFryer.Desktop.csproj");
        var issPath = Path.Combine(desktopDir, "installer", "MemeFryer.iss");
        var buildPath = Path.Combine(desktopDir, "build.mjs");

        runner.Check("the WebView2 package version is pinned exactly", () =>
        {
            var csproj = File.ReadAllText(csprojPath);
            var match = System.Text.RegularExpressions.Regex.Match(csproj, "Microsoft\\.Web\\.WebView2\" Version=\"([^\"]+)\"");
            Runner.Require(match.Success, "no pinned PackageReference found");
            Runner.Require(System.Text.RegularExpressions.Regex.IsMatch(match.Groups[1].Value, @"^\d+\.\d+\.\d+\.\d+$"),
                $"the version is not exact: {match.Groups[1].Value}");
        });

        runner.Check("the installer architecture follows the build, never a fixed x64 default", () =>
        {
            var iss = File.ReadAllText(issPath);
            Runner.Require(iss.Contains("ArchitecturesAllowed={#MyArch}", StringComparison.Ordinal),
                "ArchitecturesAllowed is not driven by MyArch");
            Runner.Require(iss.Contains("ArchitecturesInstallIn64BitMode={#MyArch}", StringComparison.Ordinal),
                "ArchitecturesInstallIn64BitMode is not driven by MyArch");

            var build = File.ReadAllText(buildPath);
            Runner.Require(build.Contains("'win-arm64': 'arm64'", StringComparison.Ordinal),
                "build.mjs has no arm64 mapping");
            Runner.Require(build.Contains("'win-x64': 'x64compatible'", StringComparison.Ordinal),
                "build.mjs has no x64 mapping");
            Runner.Require(build.Contains("/DMyArch=${innoArchitecture}", StringComparison.Ordinal),
                "build.mjs does not pass MyArch to ISCC");
        });

        runner.Check("the published exe architecture is checked against the runtime", () =>
        {
            var build = File.ReadAllText(buildPath);
            Runner.Require(build.Contains("0x8664", StringComparison.Ordinal), "no x64 PE machine check");
            Runner.Require(build.Contains("0xaa64", StringComparison.Ordinal), "no arm64 PE machine check");
        });

        runner.Check("--verify trusts only a report that parses and passes", () =>
        {
            var build = File.ReadAllText(buildPath);
            Runner.Require(build.Contains("selfcheck-report.mjs", StringComparison.Ordinal),
                "build.mjs does not use the shared report gate");
            Runner.Require(build.Contains("readSelfCheckReport", StringComparison.Ordinal),
                "build.mjs does not call readSelfCheckReport");

            // The gate's behaviour is exercised by desktop/test.mjs; these are its required rules.
            var gate = File.ReadAllText(Path.Combine(desktopDir, "selfcheck-report.mjs"));
            Runner.Require(gate.Contains("produced no report", StringComparison.Ordinal), "a missing report is not rejected");
            Runner.Require(gate.Contains("not valid JSON", StringComparison.Ordinal), "an unparsable report is not rejected");
            Runner.Require(gate.Contains("does not say passed=true", StringComparison.Ordinal), "a report that is not passing is not rejected");
            Runner.Require(gate.Contains("failing check", StringComparison.Ordinal), "individual failing checks are not rejected");
            Runner.Require(gate.Contains("refusing to trust", StringComparison.Ordinal), "exit code and report are not cross-checked");
        });

        runner.Check("the release build names three assets from a clean commit and proves each", () =>
        {
            var build = File.ReadAllText(buildPath);
            Runner.Require(build.Contains("'--release'", StringComparison.Ordinal),
                "build.mjs has no --release option");
            Runner.Require(
                build.Contains("options.runtime === 'win-x64' ? 'x64' : 'arm64'", StringComparison.Ordinal) &&
                build.Contains("-portable-${portableTag}.zip", StringComparison.Ordinal),
                "no portable zip asset name, or no x64/arm64 tag for it");
            Runner.Require(build.Contains("-source.zip", StringComparison.Ordinal),
                "no source zip asset name");
            Runner.Require(build.Contains("status', '--porcelain'", StringComparison.Ordinal),
                "a dirty worktree is not refused");
            Runner.Require(build.Contains("'--format=zip'", StringComparison.Ordinal) &&
                build.Contains("--prefix=${prefix}", StringComparison.Ordinal),
                "the source zip is not a git archive under one root");
            Runner.Require(build.Contains("assertZipRoots(", StringComparison.Ordinal) &&
                build.Contains("zipEntries(", StringComparison.Ordinal),
                "the archives' roots are never read back");
            Runner.Require(build.Contains("sha256(", StringComparison.Ordinal),
                "the assets are not hashed for the report");
        });

        runner.Check("the build never writes into the app lane's folder", () =>
        {
            // app/ is owned by another lane, so every mention of appSrc in the build has to be a
            // read. The list is closed on purpose: a new mention fails here until someone justifies
            // it, which fails safe where a pattern that stopped matching would not.
            var allowed = new[]
            {
                "const appSrc = join(repoRoot, 'app');",
                "const appEntry = join(appSrc, 'index.html');",
                "cpSync(appSrc, appDest, { recursive: true });",
            };

            var lines = File.ReadAllLines(buildPath);
            var mentions = lines.Count(line => line.Contains("appSrc", StringComparison.Ordinal));
            Runner.Require(mentions >= allowed.Length,
                "build.mjs barely mentions appSrc, so this check proves nothing");

            foreach (var line in lines.Where(line => line.Contains("appSrc", StringComparison.Ordinal)))
            {
                var trimmed = line.Trim();
                Runner.Require(allowed.Contains(trimmed),
                    $"build.mjs uses appSrc where a read is not proven: {trimmed}");
            }

            // The copy mirrors app/: a file that left the source tree must not survive in the bundle,
            // so the destination is emptied before it is filled.
            var cleared = Array.FindIndex(lines, line => line.Contains("rmSync(appDest", StringComparison.Ordinal));
            var copied = Array.FindIndex(lines, line => line.Contains("cpSync(appSrc, appDest", StringComparison.Ordinal));
            Runner.Require(cleared >= 0, "build.mjs does not clear the bundled app folder before copying");
            Runner.Require(copied > cleared,
                "build.mjs copies app/ before clearing the destination, so a stale file survives");
        });


        runner.Check("the executable, the window title and the installer all say Bytefry", () =>
        {
            var csproj = File.ReadAllText(csprojPath);
            Runner.Require(csproj.Contains("<AssemblyName>Bytefry</AssemblyName>", StringComparison.Ordinal),
                "the assembly name does not produce Bytefry.exe");
            Runner.Require(csproj.Contains("<Product>Bytefry</Product>", StringComparison.Ordinal),
                "the exe's ProductName is not Bytefry");
            Runner.Require(csproj.Contains("<AssemblyTitle>Bytefry</AssemblyTitle>", StringComparison.Ordinal),
                "the exe's FileDescription is not Bytefry");

            var form = File.ReadAllText(Path.Combine(desktopDir, "MemeFryer.Desktop", "MainForm.cs"));
            Runner.Require(form.Contains("Text = \"Bytefry\";", StringComparison.Ordinal),
                "the window title is not Bytefry");

            var program = File.ReadAllText(Path.Combine(desktopDir, "MemeFryer.Desktop", "Program.cs"));
            Runner.Require(program.Contains("Bytefry.exe [--selfcheck", StringComparison.Ordinal),
                "--help does not name Bytefry.exe");

            var iss = File.ReadAllText(issPath);
            Runner.Require(iss.Contains("#define MyAppName \"Bytefry\"", StringComparison.Ordinal),
                "the installer display name is not Bytefry");
            Runner.Require(iss.Contains("#define MyAppExeName \"Bytefry.exe\"", StringComparison.Ordinal),
                "the installer launches the wrong executable");
            Runner.Require(iss.Contains("OutputBaseFilename=Bytefry-{#MyAppVersion}-setup", StringComparison.Ordinal),
                "the setup file is not named Bytefry-<version>-setup.exe");

            var build = File.ReadAllText(buildPath);
            Runner.Require(build.Contains("'Bytefry.exe'", StringComparison.Ordinal),
                "build.mjs does not look for Bytefry.exe");
            Runner.Require(build.Contains("name.startsWith('Bytefry-')", StringComparison.Ordinal),
                "build.mjs looks for the wrong setup file");
            Runner.Require(build.Contains("name.endsWith('-setup.exe')", StringComparison.Ordinal),
                "build.mjs looks for the wrong setup file");
        });

        runner.Check("no shipped source, script or packaging file shows the pre-rename display name", () =>
        {
            // The suite itself is excluded: this check holds the forbidden string. bin/obj/dist are
            // build output, and a stale generated file is not a shipped surface.
            var offenders = new List<string>();
            var scanned = 0;

            foreach (var file in Directory.EnumerateFiles(desktopDir, "*", SearchOption.AllDirectories))
            {
                var relative = Path.GetRelativePath(desktopDir, file);
                if (relative.Split(Path.DirectorySeparatorChar)
                    .Any(part => part is "bin" or "obj" or "dist" or "tests"))
                    continue;

                if (Path.GetExtension(file) is not (".cs" or ".csproj" or ".mjs" or ".iss" or ".manifest"))
                    continue;

                scanned++;
                if (File.ReadAllText(file).Contains("Meme Fryer", StringComparison.Ordinal))
                    offenders.Add(relative);
            }

            Runner.Require(scanned > 0, "nothing was scanned, so the check proves nothing");
            Runner.Require(offenders.Count == 0,
                "the pre-rename display name is still in: " + string.Join(", ", offenders));
        });

        runner.Check("the licence is GPL-3.0-only: no file in the lane grants or-later", () =>
        {
            var files = new[]
            {
                ("MemeFryer.Desktop.csproj", File.ReadAllText(csprojPath)),
                ("NOTICE.md", File.ReadAllText(Path.Combine(desktopDir, "NOTICE.md"))),
                ("README.md", File.ReadAllText(Path.Combine(desktopDir, "README.md"))),
                ("build.mjs", File.ReadAllText(buildPath)),
            };

            foreach (var (name, text) in files)
                Runner.Require(!text.Contains("GPL-3.0-or-later", StringComparison.OrdinalIgnoreCase),
                    $"{name} still claims GPL-3.0-or-later");

            Runner.Require(File.ReadAllText(csprojPath).Contains("<Copyright>GPL-3.0-only</Copyright>", StringComparison.Ordinal),
                "the exe's copyright metadata is not GPL-3.0-only");

            var notice = File.ReadAllText(Path.Combine(desktopDir, "NOTICE.md"));
            Runner.Require(notice.Contains("GPL-3.0-only", StringComparison.Ordinal),
                "NOTICE.md does not name GPL-3.0-only");
            Runner.Require(notice.Contains("app/LICENSE", StringComparison.Ordinal),
                "NOTICE.md does not point at the full GPL text");
        });

        runner.Check("an install upgrades in place: same AppId, same profile folder, nothing deleted on uninstall", () =>
        {
            var iss = File.ReadAllText(issPath);
            Runner.Require(iss.Contains("AppId={{B4F1C8A2-5E3D-4A97-9C21-7D6E5F4A3B18}", StringComparison.Ordinal),
                "the AppId changed, so Windows would not treat an existing install as the same product");

            // A section, not a mention: prose in a comment is fine, a real section deletes files.
            Runner.Require(!System.Text.RegularExpressions.Regex.IsMatch(
                    iss, @"^[ \t]*\[UninstallDelete\]", System.Text.RegularExpressions.RegexOptions.Multiline),
                "the uninstaller deletes something outside its own install directory");

            // Every delete entry names its target, and the profile folder must not be one of them.
            Runner.Require(!System.Text.RegularExpressions.Regex.IsMatch(
                    iss, @"^[ \t]*Name:[ \t]*""\{localappdata\}", System.Text.RegularExpressions.RegexOptions.Multiline | System.Text.RegularExpressions.RegexOptions.IgnoreCase),
                "the uninstaller targets the WebView2 profile folder");

            var paths = File.ReadAllText(Path.Combine(desktopDir, "MemeFryer.Desktop", "AppPaths.cs"));
            Runner.Require(paths.Contains("\"MemeFryer\",", StringComparison.Ordinal),
                "the profile folder moved, which would orphan the WebView2 profile of an existing install");
        });

        runner.Check("the README credits the one registry write the installer makes", () =>
        {
            // The host process writes no registry value of its own. The installer does: Inno Setup's
            // CreateUninstallRegKey and Uninstallable both default to yes, neither is turned off here,
            // and the entry they create is the per-user key Apps & Features lists - which is what makes
            // an upgrade replace the old entry instead of adding a second one. A README that promises
            // "nothing is written to the registry" is therefore wrong for everyone who took the setup.
            var iss = File.ReadAllText(issPath);
            var registers = iss.Contains("AppId=", StringComparison.Ordinal) &&
                !System.Text.RegularExpressions.Regex.IsMatch(
                    iss, @"^[ \t]*(CreateUninstallRegKey|Uninstallable)[ \t]*=[ \t]*no",
                    System.Text.RegularExpressions.RegexOptions.Multiline | System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            Runner.Require(registers,
                "the installer no longer registers itself, so this check is measuring the wrong product");

            var root = Path.GetFullPath(Path.Combine(desktopDir, ".."));
            var readme = File.ReadAllText(Path.Combine(root, "README.md"));

            Runner.Require(!System.Text.RegularExpressions.Regex.IsMatch(
                    readme, @"nothing[^.\r\n]*written to the registry",
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase),
                "README.md says nothing is written to the registry, but the installer registers an Apps & Features entry");

            Runner.Require(System.Text.RegularExpressions.Regex.IsMatch(
                    readme, @"Apps & Features|Add/Remove Programs|Add or remove programs",
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase),
                "README.md never tells the reader that the installer registers the product for upgrade and removal");
        });

        runner.Check("the bundle carries the host's licence notice and names its dependencies", () =>
        {
            var build = File.ReadAllText(buildPath);
            Runner.Require(build.Contains("copyFileSync(noticeFile, join(stage, 'NOTICE.md'))", StringComparison.Ordinal),
                "build.mjs does not copy NOTICE.md into the portable folder");

            var notice = File.ReadAllText(Path.Combine(desktopDir, "NOTICE.md"));
            foreach (var dependency in new[] { "Microsoft.Web.WebView2", "WebView2 Runtime", ".NET 10", "caman", "glfx" })
                Runner.Require(notice.Contains(dependency, StringComparison.Ordinal),
                    $"NOTICE.md does not name the dependency: {dependency}");
        });

        runner.Check("the notice gives each vendored library its real licence", () =>
        {
            // app/vendor/NOTICE is the authority: CamanJS ships the 3-clause BSD text, glfx.js ships MIT.
            var lines = File.ReadAllText(Path.Combine(desktopDir, "NOTICE.md"))
                .Split('\n')
                .Select(line => line.Trim())
                .ToList();

            var caman = lines.FirstOrDefault(line => line.Contains("caman.full.min.js", StringComparison.Ordinal));
            var glfx = lines.FirstOrDefault(line => line.Contains("glfx.js", StringComparison.Ordinal));

            Runner.Require(caman is not null && caman.Contains("BSD-3-Clause", StringComparison.Ordinal),
                "the CamanJS entry does not say BSD-3-Clause");
            Runner.Require(glfx is not null && glfx.Contains("MIT", StringComparison.Ordinal),
                "the glfx.js entry does not say MIT");
        });

        runner.Check("a save never writes the destination in place", () =>
        {
            // Truncating the destination before the new bytes exist destroys the user's file when the
            // write fails. The bridge must save through a temp file in the same directory and rename.
            var bridge = File.ReadAllText(Path.Combine(desktopDir, "MemeFryer.Desktop", "Bridge.cs"));
            Runner.Require(!System.Text.RegularExpressions.Regex.IsMatch(bridge, @"WriteAllBytes(Async)?\s*\("),
                "Bridge.cs calls WriteAllBytes on the destination, so a failed write truncates it");
            Runner.Require(bridge.Contains("AtomicSave.SaveAsync", StringComparison.Ordinal),
                "Bridge.cs does not save through the temp-then-rename writer");
            Runner.Require(bridge.Contains("AtomicSave.Observe(", StringComparison.Ordinal),
                "Bridge.cs does not record the destination state when the path is chosen");
            Runner.Require(bridge.Contains("OverwritePrompt = false", StringComparison.Ordinal),
                "the dialog still asks before Bridge has read which file is there");
            Runner.Require(bridge.Contains("_confirmReplace(", StringComparison.Ordinal),
                "Bridge.cs does not confirm a replacement against the file it just read");

            // The writer is only safe while it keeps these properties; name them so a rewrite that
            // drops one goes red here rather than in a user's folder.
            var atomic = File.ReadAllText(Path.Combine(desktopDir, "MemeFryer.Desktop", "AtomicSave.cs"));
            Runner.Require(atomic.Contains("FileMode.CreateNew", StringComparison.Ordinal),
                "the temporary file is not created exclusively, so the cleanup could delete someone else's file");
            Runner.Require(!atomic.Contains("FileMode.Create,", StringComparison.Ordinal) &&
                           !atomic.Contains("FileMode.Truncate", StringComparison.Ordinal),
                "a file is opened with truncate");
            Runner.Require(atomic.Contains("stream.Flush(flushToDisk: true)", StringComparison.Ordinal),
                "the bytes are not flushed to disk before the rename");
            Runner.Require(atomic.Contains("File.Replace(", StringComparison.Ordinal),
                "an existing destination is not replaced atomically");
            Runner.Require(atomic.Contains("DeleteTemp(temp)", StringComparison.Ordinal),
                "a failed save does not clean up its own temporary file");
            Runner.Require(atomic.Contains("DestinationSnapshot", StringComparison.Ordinal) &&
                           atomic.Contains("internal static DestinationSnapshot Observe(", StringComparison.Ordinal),
                "the save does not carry the destination identity it saw when the path was chosen");
            Runner.Require(atomic.Contains("GetFileInformationByHandle", StringComparison.Ordinal),
                "the save cannot tell one file from another that reuses its name");
            Runner.Require(atomic.Contains("SetAccessRuleProtection(isProtected: true", StringComparison.Ordinal) &&
                           atomic.Contains("WellKnownSidType.LocalSystemSid", StringComparison.Ordinal),
                "the staged file is not restricted to the current user and SYSTEM before it is written");
            Runner.Require(atomic.Contains("RestoreInheritance(", StringComparison.Ordinal),
                "a newly created destination never gets its folder's permissions back");
            Runner.Require(!atomic.Contains("overwrite: true", StringComparison.Ordinal),
                "the save can fall back to a move that overwrites and drops the destination's metadata");
            Runner.Require(!atomic.Contains("ignoreMetadataErrors: true", StringComparison.Ordinal),
                "a metadata failure during the replace would be ignored instead of failing the save");
        });
    }


    /// <summary>
    /// The window's caption is Windows' own: the host asks DWM for colours and draws nothing. These
    /// checks hold the parts that are hard to see by eye — the fallbacks for old Windows builds, high
    /// contrast, a palette that moved, and the styles a custom title bar would quietly take away.
    /// </summary>
    private static void ChromeChecks(Runner runner)
    {
        runner.Check("the caption plan is right on every Windows build it can meet", () =>
        {
            // Dark tells whether a dark caption is asked for; Colors whether a colour is asked for
            // at all; Attribute 0 means the build has nothing to ask.
            var rows = new (Version Build, bool HighContrast, bool Dark, int Attribute, bool Colors, string Name)[]
            {
                (new Version(10, 0, 26100, 0), false, true, 20, true, "Windows 11 24H2"),
                (new Version(10, 0, 22631, 0), false, true, 20, true, "Windows 11 23H2"),
                (new Version(10, 0, 19045, 0), false, true, 20, false, "Windows 10 22H2"),
                (new Version(10, 0, 18985, 0), false, true, 20, false, "Windows 10 2004: the first documented attribute 20"),
                (new Version(10, 0, 18363, 0), false, true, 19, false, "Windows 10 1909: attribute 19"),
                (new Version(10, 0, 17763, 0), false, true, 19, false, "Windows 10 1809: the first dark caption"),
                (new Version(10, 0, 17134, 0), false, false, 0, false, "Windows 10 1803: nothing to ask for"),
                (new Version(6, 3, 9600, 0), false, false, 0, false, "Windows 8.1"),
                (new Version(10, 0, 26100, 0), true, false, 20, false, "Windows 11 in high contrast"),
                (new Version(10, 0, 19045, 0), true, false, 20, false, "Windows 10 in high contrast"),
            };

            foreach (var row in rows)
            {
                var plan = WindowChrome.Decide(row.Build, row.HighContrast);

                Runner.Require(plan.DarkTitleBar == row.Dark,
                    $"{row.Name}: dark title bar {plan.DarkTitleBar}, expected {row.Dark}");
                Runner.Require(plan.DarkModeAttribute == row.Attribute,
                    $"{row.Name}: attribute {plan.DarkModeAttribute}, expected {row.Attribute}");
                Runner.Require((plan.CaptionColor is not null) == row.Colors,
                    $"{row.Name}: caption colour {Hex(plan.CaptionColor)}, expected {(row.Colors ? "one" : "none")}");
                Runner.Require((plan.CaptionTextColor is not null) == (plan.CaptionColor is not null),
                    $"{row.Name}: a caption fill without its text colour");
                Runner.Require(plan.Reason.Length > 0, $"{row.Name}: no reason given for the decision");
                Runner.Require(plan.Supported == (row.Attribute != 0),
                    $"{row.Name}: Supported disagrees with the attribute it carries");
            }
        });

        runner.Check("high contrast hands a coloured caption back to the system", () =>
        {
            var plan = WindowChrome.Decide(new Version(10, 0, 26100, 0), highContrast: true);
            Runner.Require(!plan.DarkTitleBar, "high contrast still asks for a dark caption");
            Runner.Require(plan.CaptionColor is null && plan.CaptionTextColor is null,
                "high contrast still asks for a caption colour it cannot know the palette of");
            Runner.Require(plan.SupportsCaptionColor,
                "high contrast on Windows 11 would leave a caption coloured before it was switched on");

            // Windows 10 has no such attribute: naming it there would be an invented call, not a clear.
            var legacy = WindowChrome.Decide(new Version(10, 0, 19045, 0), highContrast: true);
            Runner.Require(!legacy.SupportsCaptionColor, "Windows 10 claims a caption colour attribute it does not have");
        });

        runner.Check("the caption paints the app's own header and text colours", () =>
        {
            // The page's top bar is --panel and sits directly under the caption; --text is the colour
            // of every label on it. If the app's palette moves, this goes red here instead of shipping
            // a title bar that no longer joins the page.
            var css = File.ReadAllText(Path.Combine(RepoPath("app"), "styles.css"));

            var panel = CssColor(css, "--panel");
            var text = CssColor(css, "--text");

            Runner.Require(WindowChrome.CaptionColor.ToArgb() == panel.ToArgb(),
                $"app/styles.css --panel is {Hex(panel)} but the caption paints {Hex(WindowChrome.CaptionColor)}");
            Runner.Require(WindowChrome.CaptionTextColor.ToArgb() == text.ToArgb(),
                $"app/styles.css --text is {Hex(text)} but the caption text paints {Hex(WindowChrome.CaptionTextColor)}");
        });

        runner.Check("a caption colour reaches the window as Windows' COLORREF", () =>
        {
            // COLORREF is 0x00BBGGRR, so #0E131A is 0x001A130E. Handing Windows the RGB value is the
            // classic way to paint a caption a colour nobody designed.
            Runner.Require(ColorTranslator.ToWin32(WindowChrome.CaptionColor) == 0x001A130E,
                $"the caption COLORREF is 0x{ColorTranslator.ToWin32(WindowChrome.CaptionColor):X8}, expected 0x001A130E");
            Runner.Require(ColorTranslator.ToWin32(WindowChrome.CaptionTextColor) == 0x00F7EEE7,
                $"the caption text COLORREF is 0x{ColorTranslator.ToWin32(WindowChrome.CaptionTextColor):X8}, expected 0x00F7EEE7");
        });

        runner.Check("a window with no handle is reported, never thrown at", () =>
        {
            // Called from a handle-created path, so a throw here would take the app down instead of
            // leaving one light caption on a dark app.
            var result = WindowChrome.Apply(IntPtr.Zero);

            Runner.Require(!result.DarkModeAccepted && !result.CaptionAccepted, "an absent window was reported as themed");
            Runner.Require(result.Detail.Contains("handle", StringComparison.OrdinalIgnoreCase),
                $"the refusal does not say what was missing: {result.Detail}");
            Runner.Require(result.Plan.Reason.Length > 0, "the refusal carries no reason");
        });

        runner.Check("no handle means no DWM call at all", () =>
        {
            var dwm = new FakeDwm();
            var plan = WindowChrome.Decide(new Version(10, 0, 26100, 0), highContrast: false);
            WindowChrome.Apply(IntPtr.Zero, plan, dwm);

            Runner.Require(dwm.Calls.Count == 0, $"an absent window still produced calls: {string.Join(", ", dwm.Calls)}");
        });


        runner.Check("a legacy build is set and read back through the attribute it set", () =>
        {
            // Windows 10 1809-1909 honour attribute 19. Asking them for 20 afterwards answers for an
            // attribute this build never set, so the evidence would be about the wrong number.
            var plan = WindowChrome.Decide(new Version(10, 0, 18363, 0), highContrast: false);
            var dwm = new FakeDwm();
            var result = WindowChrome.Apply(new IntPtr(1), plan, dwm);

            Runner.Require(dwm.Calls.Contains("set 19=0x00000001"),
                $"the dark caption was not set on attribute 19: {string.Join(", ", dwm.Calls)}");
            Runner.Require(dwm.Calls.Contains("get 19"),
                $"the readback did not query attribute 19: {string.Join(", ", dwm.Calls)}");
            Runner.Require(!dwm.Calls.Any(call => call.StartsWith("get 20", StringComparison.Ordinal)),
                $"the readback queried attribute 20 on a build that set 19: {string.Join(", ", dwm.Calls)}");
            Runner.Require(result.DarkModeObserved == 1, $"the readback did not report the value it read: {result.DarkModeObserved}");
        });

        runner.Check("a documented build is read back through attribute 20", () =>
        {
            var plan = WindowChrome.Decide(new Version(10, 0, 26100, 0), highContrast: false);
            var dwm = new FakeDwm();
            var result = WindowChrome.Apply(new IntPtr(1), plan, dwm);

            Runner.Require(dwm.Calls.Contains("get 20"), $"the readback did not query attribute 20: {string.Join(", ", dwm.Calls)}");
            Runner.Require(result.DarkModeObserved == 1, "the value DWM answered was not published");
        });

        runner.Check("a refused caption colour hands both colours back to the system", () =>
        {
            // A caption fill that lands without its text colour, or the reverse, is a title nobody can
            // read. The pair is committed together or handed back together.
            foreach (var refused in new[] { 35, 36 })
            {
                var plan = WindowChrome.Decide(new Version(10, 0, 26100, 0), highContrast: false);
                var dwm = new FakeDwm { SetResult = attribute => attribute == refused ? unchecked((int)0x80070057) : 0 };
                var result = WindowChrome.Apply(new IntPtr(1), plan, dwm);

                Runner.Require(!result.CaptionAccepted, $"attribute {refused} was reported as accepted");

                var colors = dwm.Calls.Where(call => call.StartsWith("set 35", StringComparison.Ordinal) ||
                                                     call.StartsWith("set 36", StringComparison.Ordinal)).ToList();
                Runner.Require(colors.Count >= 4,
                    $"with attribute {refused} refused, the pair was not handed back: {string.Join(", ", dwm.Calls)}");
                Runner.Require(colors[^1].Contains("0xFFFFFFFF", StringComparison.Ordinal) &&
                               colors[^2].Contains("0xFFFFFFFF", StringComparison.Ordinal),
                    $"the last two colour calls are not both the system default: {string.Join(", ", dwm.Calls)}");
                Runner.Require(result.Detail.Contains("system", StringComparison.OrdinalIgnoreCase),
                    $"the report does not say the colours went back to the system: {result.Detail}");
            }
        });

        runner.Check("high contrast hands both colours back even when the plan asks for none", () =>
        {
            var plan = WindowChrome.Decide(new Version(10, 0, 26100, 0), highContrast: true);
            var dwm = new FakeDwm();
            var result = WindowChrome.Apply(new IntPtr(1), plan, dwm);

            var colors = dwm.Calls.Where(call => call.StartsWith("set 3", StringComparison.Ordinal)).ToList();
            Runner.Require(colors.Count == 2, $"high contrast made {colors.Count} colour calls, expected 2");
            Runner.Require(colors.All(call => call.Contains("0xFFFFFFFF", StringComparison.Ordinal)),
                $"high contrast did not clear both colours: {string.Join(", ", colors)}");
            Runner.Require(dwm.Calls.Contains("set 20=0x00000000"), "high contrast still asked for a dark caption");
            Runner.Require(result.CaptionAccepted, "the clears were refused, which the report must not hide");
        });

        runner.Check("an unreachable dwmapi is reported, never thrown at", () =>
        {
            // Both ways windows-inbox DLLs go missing by name, from every call the caption makes.
            foreach (var missing in new[] { typeof(DllNotFoundException), typeof(EntryPointNotFoundException) })
            {
                var plan = WindowChrome.Decide(new Version(10, 0, 26100, 0), highContrast: false);
                var dwm = new FakeDwm { Throw = missing };
                var result = WindowChrome.Apply(new IntPtr(1), plan, dwm);

                Runner.Require(!result.DarkModeAccepted, $"{missing.Name} from the dark caption was reported as applied");
                Runner.Require(!result.CaptionAccepted, $"{missing.Name} from the colours was reported as applied");
                Runner.Require(result.DarkModeObserved is null,
                    $"{missing.Name} still produced a readback of {result.DarkModeObserved}");
                Runner.Require(result.Detail.Contains("unavailable", StringComparison.OrdinalIgnoreCase),
                    $"{missing.Name} is not named in the report: {result.Detail}");
            }
        });

        runner.Check("a readback DWM cannot answer is reported as no evidence, not a failure", () =>
        {
            var plan = WindowChrome.Decide(new Version(10, 0, 26100, 0), highContrast: false);
            var dwm = new FakeDwm { GetResult = _ => (unchecked((int)0x80070057), 0) };
            var result = WindowChrome.Apply(new IntPtr(1), plan, dwm);

            Runner.Require(result.DarkModeAccepted, "a refused query was reported as a refused caption");
            Runner.Require(result.DarkModeObserved is null, $"a refused query reported {result.DarkModeObserved}");
            Runner.Require(result.Detail.Contains("read back", StringComparison.OrdinalIgnoreCase) ||
                           result.Detail.Contains("quer", StringComparison.OrdinalIgnoreCase),
                $"the report does not say the readback was refused: {result.Detail}");
        });

        runner.Check("an absent window cannot pass the native-caption check", () =>
        {
            // The gate the self-check reads has to be able to go red, or it proves nothing.
            Runner.Require(WindowChrome.MissingCaptionStyles(IntPtr.Zero).Count > 0,
                "an absent window reported a complete native caption");
        });

        runner.Check("the host asks DWM for the caption instead of drawing one", () =>
        {
            var hostDir = Path.Combine(RepoPath("desktop"), "MemeFryer.Desktop");
            var sources = Directory
                .EnumerateFiles(hostDir, "*.cs", SearchOption.AllDirectories)
                .Where(file => !file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}") &&
                               !file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"))
                .ToList();

            Runner.Require(sources.Count > 0, "no host source was scanned, so the check proves nothing");

            // A custom title bar is not a style choice: it takes away the drag region, Snap Layouts,
            // the system menu, keyboard access and Windows' own automation for the caption, and no
            // off-screen check here can see whether the replacement actually works.
            foreach (var file in sources)
            {
                var text = File.ReadAllText(file);
                foreach (var forbidden in new[] { "FormBorderStyle", "NCCALCSIZE", "WM_NCHITTEST", "ExtendFrameIntoClientArea" })
                {
                    Runner.Require(!text.Contains(forbidden, StringComparison.Ordinal),
                        $"{Path.GetFileName(file)} draws its own window frame ({forbidden})");
                }
            }

            var form = File.ReadAllText(Path.Combine(hostDir, "MainForm.cs"));
            Runner.Require(form.Contains("WindowChrome.Apply(Handle)", StringComparison.Ordinal),
                "the form never asks DWM for the caption");
            Runner.Require(form.Contains("OnHandleCreated", StringComparison.Ordinal),
                "the caption would not survive a recreated window handle");
            Runner.Require(form.Contains("WmSettingChange", StringComparison.Ordinal),
                "the caption is not re-decided when the system theme or contrast changes");

            var selfCheck = File.ReadAllText(Path.Combine(hostDir, "SelfCheck.cs"));
            Runner.Require(selfCheck.Contains("MissingCaptionStyles", StringComparison.Ordinal),
                "the off-screen self-check does not prove the native caption is still there");
            Runner.Require(selfCheck.Contains("DWM accepted the dark title bar", StringComparison.Ordinal),
                "the off-screen self-check does not prove DWM accepted the dark caption");
        });
    }

    private static string Hex(Color? color) =>
        color is { } value ? $"#{value.R:X2}{value.G:X2}{value.B:X2}" : "(none)";

    /// <summary>Reads one hex token out of <c>app/styles.css</c>.</summary>
    private static Color CssColor(string css, string token)
    {
        var match = System.Text.RegularExpressions.Regex.Match(
            css, System.Text.RegularExpressions.Regex.Escape(token) + @":\s*(#[0-9a-fA-F]{6})\s*;");

        Runner.Require(match.Success, $"app/styles.css no longer declares {token}");
        return ColorTranslator.FromHtml(match.Groups[1].Value);
    }

    /// <summary>
    /// A DWM that answers what a test needs and records every call in the order it was made, so a
    /// refusal, a rollback or a query can be asserted rather than assumed.
    /// </summary>
    private sealed class FakeDwm : IDwmApi
    {
        internal List<string> Calls { get; } = new();
        internal Func<int, int> SetResult { get; init; } = _ => 0;
        internal Func<int, (int Result, int Value)> GetResult { get; init; } = _ => (0, 1);
        internal Type? Throw { get; init; }

        public int Set(IntPtr window, int attribute, int value)
        {
            Calls.Add($"set {attribute}=0x{value:X8}");
            if (Throw is not null) throw Failed(Throw);
            return SetResult(attribute);
        }

        public int Get(IntPtr window, int attribute, out int value)
        {
            Calls.Add($"get {attribute}");
            value = 0;
            if (Throw is not null) throw Failed(Throw);

            var (result, answer) = GetResult(attribute);
            value = answer;
            return result;
        }

        private static Exception Failed(Type type) => (Exception)Activator.CreateInstance(type)!;
    }

    /// <summary>
    /// The icon is one file used three ways: the exe's Win32 resource, the window's <c>Form.Icon</c> and
    /// the installer. These checks fail if a size disappears, if a frame is malformed, or if any of the
    /// three stops pointing at the same asset.
    /// </summary>
    private static void IconChecks(Runner runner)
    {
        var desktopDir = RepoPath("desktop");
        var assetDir = Path.Combine(desktopDir, "MemeFryer.Desktop", "Assets");
        var iconPath = Path.Combine(assetDir, "MemeFryer.ico");

        runner.Check("the icon carries one well-formed frame per size Windows asks for", () =>
        {
            var bytes = File.ReadAllBytes(iconPath);
            Runner.Require(bytes.Length > 22, "the icon file is too small to hold a directory");

            Runner.RequireEqual(0, (int)BitConverter.ToUInt16(bytes, 0), "reserved field");
            Runner.RequireEqual(1, (int)BitConverter.ToUInt16(bytes, 2), "type field (1 = icon)");
            var count = (int)BitConverter.ToUInt16(bytes, 4);
            Runner.RequireEqual(IconSizes.Length, count, "frame count");

            var sizes = new List<int>();
            for (var i = 0; i < count; i++)
            {
                var entry = 6 + 16 * i;
                var width = bytes[entry] == 0 ? 256 : bytes[entry];
                var height = bytes[entry + 1] == 0 ? 256 : bytes[entry + 1];
                var planes = (int)BitConverter.ToUInt16(bytes, entry + 4);
                var bits = (int)BitConverter.ToUInt16(bytes, entry + 6);
                var length = BitConverter.ToInt32(bytes, entry + 8);
                var offset = BitConverter.ToInt32(bytes, entry + 12);

                Runner.RequireEqual(width, height, "a frame is not square");
                Runner.RequireEqual(1, planes, $"{width} px plane count");
                Runner.RequireEqual(32, bits, $"{width} px colour depth");
                Runner.Require(offset >= 6 + 16 * count && length > 0 && offset + length <= bytes.Length,
                    $"{width} px payload lies outside the file");

                var payload = new ReadOnlySpan<byte>(bytes, offset, length);
                if (width >= 256)
                {
                    ReadOnlySpan<byte> png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
                    Runner.Require(payload[..8].SequenceEqual(png), "the 256 px frame is not PNG-compressed");
                }
                else
                {
                    var headerSize = BitConverter.ToInt32(payload[..4]);
                    var headerWidth = BitConverter.ToInt32(payload.Slice(4, 4));
                    var headerHeight = BitConverter.ToInt32(payload.Slice(8, 4));
                    var maskRow = (width + 31) / 32 * 4;

                    Runner.RequireEqual(40, headerSize, $"{width} px BITMAPINFOHEADER size");
                    Runner.RequireEqual(width, headerWidth, $"{width} px DIB width");
                    Runner.RequireEqual(width * 2, headerHeight, $"{width} px DIB height (image + AND mask)");
                    Runner.RequireEqual(40 + width * width * 4 + maskRow * width, length, $"{width} px frame length");
                }

                sizes.Add(width);
            }

            Runner.Require(sizes.SequenceEqual(IconSizes), $"frames are {string.Join(", ", sizes)}");
        });

        runner.Check("the window icon loads from the assembly at every size a window asks for", () =>
        {
            foreach (var size in IconSizes.Where(size => size <= 128))
            {
                using var icon = AppIcon.Load(new Size(size, size));
                Runner.RequireEqual(size, icon.Width, $"icon width at {size} px");
                Runner.RequireEqual(size, icon.Height, $"icon height at {size} px");
                Runner.Require(icon.Handle != IntPtr.Zero, $"no native icon handle at {size} px");
            }

            using var windowIcon = AppIcon.ForWindow();
            Runner.Require(windowIcon.Width >= 16, "the window icon resolved smaller than 16 px");
        });

        runner.Check("the host, the installer and the build all use the one icon file", () =>
        {
            var csproj = File.ReadAllText(Path.Combine(desktopDir, "MemeFryer.Desktop", "MemeFryer.Desktop.csproj"));
            Runner.Require(csproj.Contains(@"<ApplicationIcon>Assets\MemeFryer.ico</ApplicationIcon>", StringComparison.Ordinal),
                "the exe has no ApplicationIcon");
            Runner.Require(csproj.Contains($"LogicalName=\"{AppIcon.ResourceName}\"", StringComparison.Ordinal),
                $"the embedded resource does not match AppIcon.ResourceName ({AppIcon.ResourceName})");

            var form = File.ReadAllText(Path.Combine(desktopDir, "MemeFryer.Desktop", "MainForm.cs"));
            Runner.Require(form.Contains("Icon = AppIcon.ForWindow();", StringComparison.Ordinal),
                "the window never takes the embedded icon");

            var iss = File.ReadAllText(Path.Combine(desktopDir, "installer", "MemeFryer.iss"));
            Runner.Require(iss.Contains(@"#define IconFile ""..\MemeFryer.Desktop\Assets\MemeFryer.ico""", StringComparison.Ordinal),
                "the installer's icon default does not point at the asset");
            Runner.Require(iss.Contains("SetupIconFile={#IconFile}", StringComparison.Ordinal),
                "SetupIconFile is not driven by IconFile");
            Runner.Require(iss.Contains(@"UninstallDisplayIcon={app}\{#MyAppExeName}", StringComparison.Ordinal),
                "the uninstall entry has no icon");

            var build = File.ReadAllText(Path.Combine(desktopDir, "build.mjs"));
            Runner.Require(build.Contains(@"join(projectDir, 'Assets', 'MemeFryer.ico')", StringComparison.Ordinal),
                "build.mjs does not name the icon asset");
            Runner.Require(build.Contains(@"/DIconFile=${iconFile}", StringComparison.Ordinal),
                "build.mjs does not pass IconFile to ISCC");
        });

        runner.Check("no frame paints a background: every corner and side is fully transparent", () =>
        {
            foreach (var frame in ReadIconFrames(iconPath))
            {
                var edge = frame.Size - 1;
                var alpha = (int x, int y) => frame.Pixels[(y * frame.Size + x) * 4 + 3];

                foreach (var (x, y, corner) in new[]
                         {
                             (0, 0, "top-left"), (edge, 0, "top-right"),
                             (0, edge, "bottom-left"), (edge, edge, "bottom-right"),
                             (frame.Size / 2, 0, "top"), (0, frame.Size / 2, "left"),
                             (edge, frame.Size / 2, "right"),
                         })
                {
                    Runner.RequireEqual(0, alpha(x, y),
                        $"{frame.Size} px {corner} is not transparent, so a ground is baked into the frame");
                }
            }
        });

        runner.Check("each frame draws the mark at an icon-sized share of its pixels", () =>
        {
            foreach (var frame in ReadIconFrames(iconPath))
            {
                var covered = 0;
                for (var index = 3; index < frame.Pixels.Length; index += 4)
                {
                    if (frame.Pixels[index] > 0) covered++;
                }

                var share = (double)covered / (frame.Size * frame.Size);
                Runner.Require(share is > 0.30 and < 0.70,
                    $"{frame.Size} px draws {share:P0} of its pixels: a clipped or an empty frame");
            }
        });

        runner.Check("the 256 px frame is the app's violet and cyan, not another palette", () =>
        {
            var frame = ReadIconFrames(iconPath).Single(item => item.Size == 256);
            int solid = 0, warm = 0, cool = 0;

            for (var index = 0; index < frame.Pixels.Length; index += 4)
            {
                if (frame.Pixels[index + 3] < 200) continue;
                solid++;
                var red = frame.Pixels[index];
                var blue = frame.Pixels[index + 2];
                if (red > blue + 60) warm++;
                if (blue > red + 60) cool++;
            }

            Runner.Require(solid > 256 * 256 / 4, $"only {solid} solid pixels at 256 px");
            Runner.Require(warm * 20 < solid,
                $"{warm} of {solid} solid pixels are warm: the mark does not hold to the app's cool palette");
            Runner.Require(cool * 5 > solid * 4,
                $"{cool} of {solid} solid pixels are cool, so the mark is not the violet-and-cyan art");
        });

        runner.Check("the README, the generator and the .ico name one vector source", () =>
        {
            var root = Path.GetFullPath(Path.Combine(desktopDir, ".."));
            var svg = Path.Combine(root, "assets", "icon.svg");
            Runner.Require(File.Exists(svg), "assets/icon.svg is missing: nothing to rebuild the icon from");

            var art = File.ReadAllText(svg);
            Runner.Require(art.Contains("<svg", StringComparison.Ordinal) && art.Contains("viewBox=", StringComparison.Ordinal),
                "the icon source is not an svg document with a viewBox");

            var readme = File.ReadAllText(Path.Combine(root, "README.md"));
            Runner.Require(readme.Contains("src=\"assets/icon.svg\"", StringComparison.Ordinal),
                "the README does not show the vector the .ico is built from");

            var generator = File.ReadAllText(Path.Combine(assetDir, "make-icon.py"));
            Runner.Require(generator.Contains("\"assets\" / \"icon.svg\"", StringComparison.Ordinal),
                "make-icon.py does not read assets/icon.svg");
            Runner.Require(!generator.Contains("icon-source", StringComparison.Ordinal),
                "make-icon.py still reads the replaced raster master");
            Runner.Require(!File.Exists(Path.Combine(assetDir, "icon-source.png")),
                "the replaced raster master is still in the assets folder");
        });

        runner.Check("the .ico and the vector are the pair the generator recorded", () =>
        {
            var root = Path.GetFullPath(Path.Combine(desktopDir, ".."));
            var svg = Path.Combine(root, "assets", "icon.svg");
            var record = Path.Combine(assetDir, "icon.lock");

            Runner.Require(File.Exists(record),
                "icon.lock is missing: nothing binds the .ico to the vector on a machine without Python");

            var recorded = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var line in File.ReadAllLines(record))
            {
                if (line.Trim().Length == 0 || line.TrimStart().StartsWith('#')) continue;
                var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                Runner.Require(parts.Length == 2 && parts[1].Length == 64,
                    $"icon.lock holds a line that is not '<svg|ico> <sha256>': {line}");
                recorded[parts[0]] = parts[1];
            }

            Runner.Require(recorded.ContainsKey("svg") && recorded.ContainsKey("ico"),
                "icon.lock does not record both the svg and the ico");

            // A digest of each file against the recorded one: neither may move alone, and neither
            // needs Python, Pillow or numpy to be checked.
            foreach (var (key, path) in new[] { ("svg", svg), ("ico", iconPath) })
            {
                var actual = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(path)));
                Runner.RequireEqual(recorded[key], actual,
                    $"{Path.GetFileName(path)} changed without re-running make-icon.py, so the icon and its source disagree");
            }
        });

        var python = ResolvePython();
        if (python is null || !PythonHasPillow(python, assetDir))
        {
            // The digest check above still guards the pair; this deeper one only re-renders.
            runner.Skip("a fresh render of the vector still produces the committed .ico",
                python is null ? "no python on PATH" : "python has no Pillow or numpy");
        }
        else
        {
            runner.Check("a fresh render of the vector still produces the committed .ico", () =>
            {
                var (code, output) = RunProcess(python, new[] { "make-icon.py", "--check" }, assetDir);
                Runner.RequireEqual(0, code,
                    $"make-icon.py --check exited {code}: {output.Trim()}");
            });
        }
    }

    private static IEnumerable<(int Size, byte[] Pixels)> ReadIconFrames(string path)
    {
        var bytes = File.ReadAllBytes(path);
        var count = (int)BitConverter.ToUInt16(bytes, 4);

        for (var index = 0; index < count; index++)
        {
            var entry = 6 + 16 * index;
            var size = bytes[entry] == 0 ? 256 : bytes[entry];
            var length = BitConverter.ToInt32(bytes, entry + 8);
            var offset = BitConverter.ToInt32(bytes, entry + 12);
            var payload = bytes.AsSpan(offset, length);

            yield return (size, size >= 256 ? DecodePng(payload.ToArray()) : DecodeDib(payload, size));
        }
    }

    /// <summary>Top-down RGBA of one 32-bit DIB frame: the stored rows run bottom-up, BGRA.</summary>
    private static byte[] DecodeDib(ReadOnlySpan<byte> payload, int size)
    {
        var pixels = new byte[size * size * 4];
        for (var y = 0; y < size; y++)
        {
            var row = 40 + (size - 1 - y) * size * 4;
            for (var x = 0; x < size; x++)
            {
                var from = row + x * 4;
                var to = (y * size + x) * 4;
                pixels[to] = payload[from + 2];
                pixels[to + 1] = payload[from + 1];
                pixels[to + 2] = payload[from];
                pixels[to + 3] = payload[from + 3];
            }
        }

        return pixels;
    }

    private static byte[] DecodePng(byte[] payload)
    {
        using var stream = new MemoryStream(payload);
        using var bitmap = new System.Drawing.Bitmap(stream);
        var pixels = new byte[bitmap.Width * bitmap.Height * 4];

        for (var y = 0; y < bitmap.Height; y++)
        {
            for (var x = 0; x < bitmap.Width; x++)
            {
                var colour = bitmap.GetPixel(x, y);
                var at = (y * bitmap.Width + x) * 4;
                pixels[at] = colour.R;
                pixels[at + 1] = colour.G;
                pixels[at + 2] = colour.B;
                pixels[at + 3] = colour.A;
            }
        }

        return pixels;
    }

    private static string? ResolvePython()
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (var directory in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            foreach (var name in new[] { "python.exe", "python3.exe" })
            {
                var candidate = Path.Combine(directory.Trim().Trim('"'), name);
                if (File.Exists(candidate)) return candidate;
            }
        }

        return null;
    }

    /// <summary>True only when the interpreter can import what the generator needs.</summary>
    private static bool PythonHasPillow(string python, string workDir)
    {
        try
        {
            var (code, _) = RunProcess(python, new[] { "-c", "import PIL, numpy" }, workDir);
            return code == 0;
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static (int Code, string Output) RunProcess(string exe, string[] args, string workDir)
    {
        var start = new ProcessStartInfo(exe)
        {
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false,
            WorkingDirectory = workDir,
        };
        foreach (var argument in args) start.ArgumentList.Add(argument);

        using var process = Process.Start(start)
            ?? throw new InvalidOperationException($"{Path.GetFileName(exe)} did not start");
        var output = process.StandardOutput.ReadToEnd() + process.StandardError.ReadToEnd();
        if (!process.WaitForExit(120_000))
        {
            try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            throw new TimeoutException($"{Path.GetFileName(exe)} did not exit within 120s");
        }

        return (process.ExitCode, output);
    }

    private static readonly int[] IconSizes = [16, 24, 32, 48, 64, 128, 256];


    private static void CommandLineChecks(Runner runner, string tempRoot)
    {
        var exe = FindHostExe();
        if (exe is null)
        {
            runner.Skip("--help exits 0 without a window", "no built Bytefry.exe found");
            runner.Skip("--selfcheck without a path exits 64 without a window", "no built Bytefry.exe found");
            runner.Skip("a missing app bundle exits 2 before any window", "no built Bytefry.exe found");
            return;
        }

        // None of these reach MainForm: argument validation and app resolution run first, so no window
        // and no WebView2 is created.
        runner.Check("--help exits 0 without a window", () =>
        {
            var (code, _) = RunExe(exe, new[] { "--help" }, tempRoot, new Dictionary<string, string?>());
            Runner.RequireEqual(0, code, "--help exit code");
        });

        runner.Check("--selfcheck without a path exits 64 without a window", () =>
        {
            var (code, error) = RunExe(exe, new[] { "--selfcheck" }, tempRoot, new Dictionary<string, string?>());
            Runner.RequireEqual(64, code, "--selfcheck exit code");
            Runner.Require(error.Contains("report path", StringComparison.OrdinalIgnoreCase), "the error does not explain the missing path");
        });

        runner.Check("a missing app bundle exits 2 before any window", () =>
        {
            var isolated = Path.Combine(tempRoot, "isolated");
            Directory.CreateDirectory(isolated);
            var copied = Path.Combine(isolated, "Bytefry.exe");
            File.Copy(exe, copied, overwrite: true);

            var report = Path.Combine(isolated, "report.json");
            var (code, error) = RunExe(copied, new[] { "--selfcheck", report }, isolated,
                new Dictionary<string, string?> { ["MEME_FRYER_APP_DIR"] = null });

            Runner.RequireEqual(2, code, "missing-app exit code");
            Runner.Require(!File.Exists(report), "a report was written for a run that could not start");
            Runner.Require(error.Contains("was not found", StringComparison.OrdinalIgnoreCase), "the failure is not explained on stderr");
        });
    }

    private static (int Code, string Error) RunExe(string exe, string[] args, string workDir, Dictionary<string, string?> env)
    {
        var start = new ProcessStartInfo(exe)
        {
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false,
            WorkingDirectory = workDir,
        };
        foreach (var arg in args) start.ArgumentList.Add(arg);
        foreach (var (key, value) in env)
        {
            if (value is null) start.Environment.Remove(key);
            else start.Environment[key] = value;
        }

        using var process = Process.Start(start) ?? throw new InvalidOperationException("the host did not start");
        var error = process.StandardError.ReadToEnd();
        process.StandardOutput.ReadToEnd();
        if (!process.WaitForExit(30_000))
        {
            try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            throw new TimeoutException($"{Path.GetFileName(exe)} did not exit within 30s");
        }

        return (process.ExitCode, error);
    }

    private static string? FindHostExe()
    {
        var desktopDir = RepoPath("desktop");
        var candidates = new[]
        {
            Path.Combine(desktopDir, "dist", "portable", "Bytefry.exe"),
            Path.Combine(desktopDir, "MemeFryer.Desktop", "bin", "Debug", "net10.0-windows", "Bytefry.exe"),
            Path.Combine(desktopDir, "MemeFryer.Desktop", "bin", "Release", "net10.0-windows", "Bytefry.exe"),
        };

        return candidates.FirstOrDefault(File.Exists);
    }

    /// <summary>The desktop folder this test assembly was built inside, whatever the working directory is.</summary>
    private static string RepoPath(string folder)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, folder);
            if (Directory.Exists(Path.Combine(directory.FullName, "desktop", "MemeFryer.Desktop")) &&
                Directory.Exists(candidate))
                return candidate;

            directory = directory.Parent;
        }

        // Fall back to the compiled-in source location.
        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", folder));
    }

    private static string CurrentUserSid => WindowsIdentity.GetCurrent().User!.Value;

    private static readonly string EveryoneSid = new SecurityIdentifier(WellKnownSidType.WorldSid, null).Value;

    private static readonly string SystemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null).Value;

    /// <summary>Makes a folder readable by Everyone, inherited by the files inside it — the situation a
    /// save into a shared folder is in, and the one the staging file must not inherit.</summary>
    private static void GrantEveryoneRead(string directory)
    {
        var info = new DirectoryInfo(directory);
        var security = info.GetAccessControl();
        security.AddAccessRule(new FileSystemAccessRule(
            new SecurityIdentifier(WellKnownSidType.WorldSid, null),
            FileSystemRights.Read,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
            PropagationFlags.None,
            AccessControlType.Allow));
        info.SetAccessControl(security);
    }

    /// <summary>Every identity an allowance in the file's DACL names, explicit or inherited.</summary>
    private static string[] Grantees(string path)
    {
        var rules = new FileInfo(path)
            .GetAccessControl()
            .GetAccessRules(includeExplicit: true, includeInherited: true, typeof(SecurityIdentifier));

        return rules
            .Cast<FileSystemAccessRule>()
            .Where(rule => rule.AccessControlType == AccessControlType.Allow)
            .Select(rule => rule.IdentityReference.Value)
            .Distinct()
            .ToArray();
    }

    private static JsonElement Call(Bridge bridge, string command, object? args = null, double id = 1)
    {
        var message = JsonSerializer.Serialize(new { id, command, args = args ?? new { } });
        var reply = bridge.HandleAsync(message).GetAwaiter().GetResult()
                    ?? throw new InvalidOperationException($"no reply to {command}");
        using var document = JsonDocument.Parse(reply);
        return document.RootElement.Clone();
    }

    private static void Require(JsonElement reply, string property) =>
        Runner.Require(reply.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.True,
            reply.TryGetProperty("error", out var error) ? $"reply was not ok: {error}" : "reply was not ok");

    private sealed class NoWindow : IWin32Window
    {
        public IntPtr Handle => IntPtr.Zero;
    }
}
