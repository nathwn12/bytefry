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
/// The decision (what this Windows build supports, and what to ask for) is separate from the effects
/// (the DWM calls), and the effects sit behind <see cref="IDwmApi"/> so the fallbacks — a refused
/// call, a missing dwmapi.dll, a caption colour that lands without its text colour — can be driven
/// by the window-free suite instead of only described.
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
    internal static ChromeResult Apply(IntPtr window) => Apply(window, Decide(), DwmApi.Instance);

    /// <summary>
    /// The same call with the decision and the DWM behind it supplied, which is how the suite drives
    /// every fallback this file claims. Production only ever passes the live plan and the real DWM.
    /// </summary>
    internal static ChromeResult Apply(IntPtr window, ChromePlan plan, IDwmApi dwm)
    {
        if (window == IntPtr.Zero)
            return new ChromeResult(plan, false, false, null, "no native window handle yet");

        var notes = new List<string>();
        var darkAccepted = true;
        var captionAccepted = true;

        if (plan.Supported)
            darkAccepted = Set(dwm, window, plan.DarkModeAttribute, plan.DarkTitleBar ? 1 : 0, "dark title bar", notes);

        if (plan.SupportsCaptionColor)
        {
            var fill = Set(dwm, window, CaptionColorAttribute, ColorValue(plan.CaptionColor), "caption color", notes);
            var text = Set(dwm, window, CaptionTextColorAttribute, ColorValue(plan.CaptionTextColor), "caption text color", notes);

            // The pair is committed together or not at all: a fill the app chose under text Windows
            // chose, or the reverse, is a title nobody can read. One refused call hands both back.
            captionAccepted = fill && text;
            if (!captionAccepted)
            {
                Set(dwm, window, CaptionColorAttribute, ColorDefault, "caption color handed back", notes);
                Set(dwm, window, CaptionTextColorAttribute, ColorDefault, "caption text color handed back", notes);
                notes.Add("the caption colors went back to the system");
            }
        }

        // The dark-mode attribute is the one DWM will also answer for, so the readback is published
        // as evidence; a colour can only be set, never queried, so its calls' results are the proof.
        // It names the attribute this build was actually given - 19 on 1809-1909, 20 from 2004 - or
        // the answer would be about a number that was never set here.
        var observed = plan.Supported ? ReadBack(dwm, window, plan.DarkModeAttribute, notes) : null;

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

    private static bool Set(IDwmApi dwm, IntPtr window, int attribute, int value, string what, List<string> notes)
    {
        try
        {
            var result = dwm.Set(window, attribute, value);
            if (result == 0)
            {
                notes.Add($"{what} {attribute}=0x{value:X8}");
                return true;
            }

            Trace.WriteLine($"[meme-fryer] title bar: {what} refused: DwmSetWindowAttribute({attribute}) returned 0x{result:X8}");
            notes.Add($"{what} {attribute} refused (0x{result:X8})");
            return false;
        }
        catch (Exception ex) when (IsMissingDwm(ex))
        {
            // dwmapi.dll ships with every supported Windows; if it cannot be reached, the caption keeps
            // the colours Windows gave it and the app still starts.
            Trace.WriteLine($"[meme-fryer] title bar: {what} unavailable: {ex.Message}");
            notes.Add($"{what} unavailable ({ex.GetType().Name})");
            return false;
        }
    }

    /// <summary>
    /// DWM's answer for the dark-mode attribute on this window, or null when it will not answer.
    /// A refused query is no evidence rather than a failure — the caption was still set — and an
    /// unreachable dwmapi.dll gets the same fallback a refused call does.
    /// </summary>
    private static int? ReadBack(IDwmApi dwm, IntPtr window, int attribute, List<string> notes)
    {
        try
        {
            var result = dwm.Get(window, attribute, out var value);
            if (result == 0) return value;

            Trace.WriteLine($"[meme-fryer] title bar: read back refused: DwmGetWindowAttribute({attribute}) returned 0x{result:X8}");
            notes.Add($"read back of {attribute} refused (0x{result:X8})");
            return null;
        }
        catch (Exception ex) when (IsMissingDwm(ex))
        {
            Trace.WriteLine($"[meme-fryer] title bar: read back unavailable: {ex.Message}");
            notes.Add($"read back unavailable ({ex.GetType().Name})");
            return null;
        }
    }

    /// <summary>A windows-inbox DLL that cannot be reached: the two ways that happens by name.</summary>
    private static bool IsMissingDwm(Exception ex) =>
        ex is DllNotFoundException or EntryPointNotFoundException;

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
}

/// <summary>The DWM calls the caption needs, behind an interface so the suite can refuse them.</summary>
internal interface IDwmApi
{
    int Set(IntPtr window, int attribute, int value);

    int Get(IntPtr window, int attribute, out int value);
}

/// <summary>The real thing: <c>dwmapi.dll</c>, as shipped by Windows.</summary>
internal sealed class DwmApi : IDwmApi
{
    internal static readonly DwmApi Instance = new();

    public int Set(IntPtr window, int attribute, int value) =>
        DwmSetWindowAttribute(window, attribute, ref value, sizeof(int));

    public int Get(IntPtr window, int attribute, out int value) =>
        DwmGetWindowAttribute(window, attribute, out value, sizeof(int));

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
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
