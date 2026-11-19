using System.Diagnostics;

namespace MemeFryer.Desktop;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();

        string? selfCheckReport = null;
        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i];
            if (arg is "--selfcheck" or "-selfcheck")
            {
                if (i + 1 >= args.Length)
                {
                    Console.Error.WriteLine("--selfcheck needs a report path");
                    return 64;
                }

                selfCheckReport = args[++i];
            }
            else if (arg.StartsWith("--selfcheck=", StringComparison.Ordinal))
            {
                selfCheckReport = arg["--selfcheck=".Length..];
            }
            else if (arg is "--help" or "-h" or "/?")
            {
                Console.Out.WriteLine("Bytefry.exe [--selfcheck <report.json>]");
                Console.Out.WriteLine("  --selfcheck  run the host off-screen, write a JSON report, exit 0 on pass");
                return 0;
            }
        }

        string appDir;
        try
        {
            appDir = AppPaths.ResolveAppDir();
        }
        catch (DirectoryNotFoundException ex)
        {
            if (selfCheckReport is null)
            {
                MessageBox.Show(ex.Message, "Bytefry — app bundle missing",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            else
            {
                Console.Error.WriteLine($"[meme-fryer] self-check failed: {ex.Message}");
            }

            return 2;
        }

        var dev = AppPaths.IsDev;
        Trace.WriteLine($"[meme-fryer] app dir: {appDir} (dev={dev})");

        try
        {
            var form = new MainForm(appDir, dev, selfCheckReport);
            Application.Run(form);

            return selfCheckReport is null ? 0 : form.SelfCheckExitCode;
        }
        catch (Exception ex)
        {
            if (selfCheckReport is null)
            {
                MessageBox.Show(ex.ToString(), "Bytefry — failed to start",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            else
            {
                Console.Error.WriteLine(ex);
            }

            return 1;
        }
    }
}
