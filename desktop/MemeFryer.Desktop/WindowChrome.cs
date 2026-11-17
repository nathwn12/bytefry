using System.Diagnostics;
using System.Runtime.InteropServices;

namespace MemeFryer.Desktop;

/// <summary>
/// The window's native Windows caption, asked to match the app rather than redrawn by it.
///
/// All this does is set DWM attributes. The caption itself stays Windows': the drag region,
/// double-click to maximise, Snap Layouts, the system menu and Alt+Space, the minimise and maximise
/// buttons, the resize border, high-contrast painting, and everything a screen reader and Windows'
/// own automation see. A custom-drawn title bar would have to reimplement every one of those, and it
/// would be the part of the window that goes wrong on a scaling change, a translated system or a
/// remote session. So nothing here paints, sizes, hit-tests or removes the non-client area.
///
/// The decision (what this Windows build supports, and what to ask for) is separate from the effect
/// (the DWM calls), because the decision is the part with the fallbacks in it and the part a
/// window-free test can hold.
/// </summary>
internal static class WindowChrome
{
    /// <summary><c>DWMWA_USE_IMMERSIVE_DARK_MODE</c>: Windows 10 2004 (build 18985) and later.</summary>
    private const int DarkModeAttribute = 20;

    /// <summary>The same attribute before it was given a public number: Windows 10 1809 (build 17763).</summary>
    private const int DarkModeAttributeBefore20H1 = 19;

    /// <summary>The first Windows 10 build that honours a dark caption at all (1809).</summary>
    private const int FirstDarkBuild = 17763;

    /// <summary>The first build that honours attribute 20 under its documented number (2004).</summary>
    private const int DocumentedDarkBuild = 18985;

    /// <summary><c>DWMWA_CAPTION_COLOR</c> and <c>DWMWA_TEXT_COLOR</c>: Windows 11 (build 22000) and later.</summary>
    private const int CaptionColorAttribute = 35;
    private const int CaptionTextColorAttribute = 36;
    private const int FirstCaptionColorBuild = 22000;

    /// <summary><c>DWMWA_COLOR_DEFAULT</c>: hand the attribute back to the system palette.</summary>
    private const int ColorDefault = unchecked((int)0xFFFFFFFF);

    /// <summary>
    /// The app's own <c>--panel</c> token. The page's top bar is that colour and sits directly under
    /// the caption, so the two read as one surface instead of a title bar bolted onto a dark app.
    /// <c>desktop/tests</c> compares this with <c>app/styles.css</c> and goes red if either moves.
    /// </summary>
    internal static readonly Color CaptionColor = Color.FromArgb(0x0E, 0x13, 0x1A);

    /// <summary>The app's own <c>--text</c> token, so the title reads at the page's weight.</summary>
    internal static readonly Color CaptionTextColor = Color.FromArgb(0xE7, 0xEE, 0xF7);

    /// <summary>
    /// The plan for a given Windows build and contrast setting. Four answers, in this order: a build
    /// too old to have the attribute, high contrast (the system palette owns the caption), Windows 11
    /// (caption and text colour), Windows 10 (dark caption only: attribute 35 does not exist there).
    /// </summary>
    internal static ChromePlan Decide(Version version, bool highContrast)
    {
        var build = version.Major >= 10 ? version.Build : 0;

        if (build < FirstDarkBuild)
            return new ChromePlan(0, false, false, null, null,
                $"build {version} predates the immersive dark title bar (Windows 10 1809): the caption stays the system's");

        var attribute = build >= DocumentedDarkBuild ? DarkModeAttribute : DarkModeAttributeBefore20H1;

        if (highContrast)
        {
            // Nothing is coloured: a caption we picked cannot know the user's contrast palette. On
            // Windows 11 the colour attributes are still named, with the default, so a caption
            // coloured before high contrast was switched on is handed back rather than left behind.
            return new ChromePlan(attribute, false, build >= FirstCaptionColorBuild, null, null,
                "high contrast is on: the system palette owns the caption");
        }

        if (build >= FirstCaptionColorBuild)
        {
            return new ChromePlan(attribute, true, true, CaptionColor, CaptionTextColor,
                "dark caption, painted in the app's own header colour");
        }

        return new ChromePlan(attribute, true, false, null, null,
            "dark caption; Windows 10 has no caption colour attribute, so the frame and text stay the system's");
    }

    /// <summary>The live decision: this OS build, this contrast setting.</summary>
    internal static ChromePlan Decide() => Decide(Environment.OSVersion.Version, SystemInformation.HighContrast);

    /// <summary>
    /// Asks DWM for the live plan on this window and reports whether it landed. Safe to call again at
    /// any time and on every new handle, which is how the caption survives a recreated window and how
    /// a theme, contrast or accent change is picked up. Never throws: a refused call, or a dwmapi.dll
    /// that is not there, leaves the window with the caption Windows already gave it.
    /// </summary>
    internal static ChromeResult Apply(IntPtr window)
    {
        var plan = Decide();
        if (window == IntPtr.Zero)
            return new ChromeResult(plan, false, false, null, "no native window handle yet");

        var notes = new List<string>();
        var darkAccepted = true;
        var captionAccepted = true;

        if (plan.Supported)
            darkAccepted = Set(window, plan.DarkModeAttribute, plan.DarkTitleBar ? 1 : 0, "dark title bar", notes);

        if (plan.SupportsCaptionColor)
        {
            // Both calls run: a caption colour without its text colour is a title nobody can read.
            captionAccepted =
                Set(window, CaptionColorAttribute, ColorValue(plan.CaptionColor), "caption color", notes) &
                Set(window, CaptionTextColorAttribute, ColorValue(plan.CaptionTextColor), "caption text color", notes);
        }

        // The dark-mode attribute is the one DWM will also answer for, so the readback is published
        // as evidence; a colour can only be set, never queried, so its calls' results are the proof.
        int? observed = null;
        if (plan.Supported && DwmGetWindowAttribute(window, DarkModeAttribute, out var value, sizeof(int)) == 0)
            observed = value;

        return new ChromeResult(plan, darkAccepted, captionAccepted, observed, string.Join("; ", notes));
    }

    /// <summary>
    /// The caption's own style bits: the drag region (<c>WS_CAPTION</c>), the system menu
    /// (<c>WS_SYSMENU</c> — Alt+Space and the caption icon), the minimise and maximise buttons, and
    /// the resize border that carries Snap Layouts. Returns what is missing; an empty list means the
    /// caption is still Windows' own. The self-check reads it so a custom title bar cannot land quietly.
    /// </summary>
    internal static IReadOnlyList<string> MissingCaptionStyles(IntPtr window)
    {
        const int GwlStyle = -16;
        const int WsCaption = 0x00C00000;
        const int WsSysMenu = 0x00080000;
        const int WsMinimizeBox = 0x00020000;
        const int WsMaximizeBox = 0x00010000;
        const int WsThickFrame = 0x00040000;

        var missing = new List<string>();
        if (window == IntPtr.Zero)
        {
            missing.Add("no window handle");
            return missing;
        }

        var style = GetWindowLongPtr(window, GwlStyle).ToInt64();

        if ((style & WsCaption) != WsCaption) missing.Add("WS_CAPTION (drag region)");
        if ((style & WsSysMenu) == 0) missing.Add("WS_SYSMENU (Alt+Space)");
        if ((style & WsMinimizeBox) == 0) missing.Add("WS_MINIMIZEBOX");
        if ((style & WsMaximizeBox) == 0) missing.Add("WS_MAXIMIZEBOX");
        if ((style & WsThickFrame) == 0) missing.Add("WS_THICKFRAME (resize border, Snap Layouts)");

        return missing;
    }

    private static int ColorValue(Color? color) =>
        color is { } value ? ColorTranslator.ToWin32(value) : ColorDefault;

    private static bool Set(IntPtr window, int attribute, int value, string what, List<string> notes)
    {
        try
        {
            var result = DwmSetWindowAttribute(window, attribute, ref value, sizeof(int));
            if (result == 0)
            {
                notes.Add($"{what} {attribute}=0x{value:X8}");
                return true;
            }

            Trace.WriteLine($"[meme-fryer] title bar: {what} refused: DwmSetWindowAttribute({attribute}) returned 0x{result:X8}");
            notes.Add($"{what} {attribute} refused (0x{result:X8})");
            return false;
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException)
        {
            // dwmapi.dll ships with every supported Windows; if it cannot be reached, the caption keeps
            // the colours Windows gave it and the app still starts.
            Trace.WriteLine($"[meme-fryer] title bar: {what} unavailable: {ex.Message}");
            notes.Add($"{what} unavailable ({ex.GetType().Name})");
            return false;
        }
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
}

/// <summary>
/// What a given Windows build will be asked for, and why. Pure and total: every supported build, the
/// oldest ones, and both contrast answers have a row in the suite.
/// </summary>
internal sealed record ChromePlan(
    int DarkModeAttribute,
    bool DarkTitleBar,
    bool SupportsCaptionColor,
    Color? CaptionColor,
    Color? CaptionTextColor,
    string Reason)
{
    /// <summary>True when the build has no attribute to set at all: before Windows 10 1809.</summary>
    internal bool Supported => DarkModeAttribute != 0;
}

/// <summary>What actually happened, so a caption that did not land can name the call DWM refused.</summary>
internal sealed record ChromeResult(
    ChromePlan Plan,
    bool DarkModeAccepted,
    bool CaptionAccepted,
    int? DarkModeObserved,
    string Detail);
