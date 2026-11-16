namespace MemeFryer.Desktop;

/// <summary>
/// Where the host finds the web app, its user-data folder, and the virtual host name it serves from.
/// </summary>
internal static class AppPaths
{
    /// <summary>Virtual origin the bundled app is served from. Needs an https origin so ES modules,
    /// fetch() and service workers behave as they do on the web.</summary>
    internal const string VirtualHost = "meme-fryer.local";

    internal static readonly Color WindowBackground = Color.FromArgb(18, 18, 18);

    /// <summary>Set to 1 to keep devtools, context menus and browser accelerators available.</summary>
    internal static bool IsDev =>
        Environment.GetEnvironmentVariable("MEME_FRYER_DEV") is "1" or "true";

    /// <summary>
    /// Order: MEME_FRYER_APP_DIR, then <c>app\</c> next to the exe (portable / installed layout),
    /// then a bounded walk up the source tree to the repo root that holds <c>app\</c> beside <c>desktop\</c>.
    /// </summary>
    internal static string ResolveAppDir(string? startDirectory = null)
    {
        var start = Path.GetFullPath(startDirectory ?? AppContext.BaseDirectory);
        var searched = new List<string>();

        var fromEnv = Environment.GetEnvironmentVariable("MEME_FRYER_APP_DIR");
        if (!string.IsNullOrWhiteSpace(fromEnv))
        {
            var full = Path.GetFullPath(fromEnv);
            searched.Add($"{full}  (MEME_FRYER_APP_DIR)");
            if (HasEntryPoint(full))
                return full;
        }

        var besideExe = Path.GetFullPath(Path.Combine(start, "app"));
        searched.Add(besideExe);
        if (HasEntryPoint(besideExe))
            return besideExe;

        var dir = new DirectoryInfo(start);
        for (var depth = 0; depth < 6 && dir is not null; depth++, dir = dir.Parent)
        {
            if (!Directory.Exists(Path.Combine(dir.FullName, "desktop")))
                continue;

            var candidate = Path.Combine(dir.FullName, "app");
            searched.Add(candidate);
            if (HasEntryPoint(candidate))
                return candidate;
        }

        throw new DirectoryNotFoundException(
            "The web app bundle was not found. Bytefry serves app/index.html from a local folder.\n\n" +
            "Searched:\n  " + string.Join("\n  ", searched) + "\n\n" +
            "A portable build keeps app/ beside Bytefry.exe. A source run expects app/ beside desktop/.\n" +
            "Set MEME_FRYER_APP_DIR to point at the folder that contains index.html.");
    }

    /// <summary>Empty value means the WebView2 default (a folder beside the exe), which fails when
    /// the install directory is read-only, so the host always names a writable folder.</summary>
    /// <remarks>
    /// The folder name is deliberately still <c>MemeFryer</c>, the pre-rename name: an installed copy
    /// already has its WebView2 profile there, and pointing at a new folder would orphan that state on
    /// the first launch after the rename. Renaming it needs a one-time migration, not an edit here.
    /// </remarks>
    internal static string ResolveUserDataDir()
    {
        var fromEnv = Environment.GetEnvironmentVariable("MEME_FRYER_USER_DATA_DIR");
        var dir = string.IsNullOrWhiteSpace(fromEnv)
            ? Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "MemeFryer",
                "WebView2")
            : Path.GetFullPath(fromEnv);

        Directory.CreateDirectory(dir);
        return dir;
    }

    private static bool HasEntryPoint(string dir) =>
        File.Exists(Path.Combine(dir, "index.html"));
}
