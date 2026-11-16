namespace MemeFryer.Desktop;

/// <summary>
/// The application's own window icon: the multi-resolution <c>Assets/MemeFryer.ico</c> embedded in the
/// assembly. The exe carries the same file as its Win32 icon resource (csproj <c>ApplicationIcon</c>),
/// so Explorer, the shortcut, the taskbar and the title bar show one icon rather than the generic
/// WinForms default.
/// </summary>
internal static class AppIcon
{
    /// <summary>Logical name set in the csproj; the assembly's manifest holds exactly this resource.</summary>
    internal const string ResourceName = "MemeFryer.Desktop.Assets.MemeFryer.ico";

    /// <summary>
    /// Loads the frame Windows asks a window for: the large-icon size for the current DPI, so the
    /// taskbar and Alt-Tab get an authored frame and only the 16 px title bar is scaled down from it.
    /// </summary>
    internal static Icon ForWindow() => Load(SystemInformation.IconSize);

    /// <summary>Loads the frame closest to <paramref name="size"/>; the loader never upscales.</summary>
    internal static Icon Load(Size size)
    {
        using var stream = typeof(AppIcon).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException(
                $"the window icon resource is missing from the assembly: {ResourceName}");

        return new Icon(stream, size);
    }
}
