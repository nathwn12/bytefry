using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MemeFryer.Desktop;

/// <summary>
/// A single-window host: WebView2 fills the client area and serves the bundled app from a virtual
/// https origin so the page behaves like it does in a browser, offline, with no network surface.
/// </summary>
internal sealed class MainForm : Form
{
    private readonly string _appDir;
    private readonly bool _dev;
    private readonly string? _selfCheckReportPath;
    private readonly WebView2 _webView = new();
    private readonly TaskCompletionSource<bool> _firstNavigation =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    private Bridge? _bridge;
    private ChromeResult? _chrome;

    /// <summary><c>WM_SETTINGCHANGE</c>: the system theme, accent or contrast changed.</summary>
    private const int WmSettingChange = 0x001A;

    /// <summary>
    /// Fail-closed: a self-check that never reaches a verdict exits non-zero. Only a run that writes a
    /// passing report lowers this to 0.
    /// </summary>
    private int _selfCheckExitCode = 1;

    internal MainForm(string appDir, bool dev, string? selfCheckReportPath = null)
    {
        _appDir = appDir;
        _dev = dev;
        _selfCheckReportPath = selfCheckReportPath;

        Text = "Bytefry";
        Icon = AppIcon.ForWindow();
        AutoScaleMode = AutoScaleMode.Dpi;
        MinimumSize = new Size(760, 520);
        ClientSize = new Size(1180, 800);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = AppPaths.WindowBackground;

        if (_selfCheckReportPath is not null)
        {
            // Headless self-check: a real window is required for WebView2 to compose, so it is sized
            // normally and parked far outside the virtual desktop instead of being shown on screen.
            StartPosition = FormStartPosition.Manual;
            Location = new Point(-32000, -32000);
            ShowInTaskbar = false;
        }

        _webView.Dock = DockStyle.Fill;
        _webView.DefaultBackgroundColor = AppPaths.WindowBackground;
        Controls.Add(_webView);

        Load += OnLoaded;
    }

    /// <summary>Off-screen self-check runs must not take focus from whatever the user is doing.</summary>
    protected override bool ShowWithoutActivation => _selfCheckReportPath is not null;

    /// <summary>How the caption was asked for; the off-screen self-check reads it as evidence.</summary>
    internal ChromeResult? Chrome => _chrome;

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);

        // A window is born with the system caption, and a recreated handle is born with it again
        // (Windows reparents the form on some DPI, theme and session changes). Styling here rather
        // than once in the constructor is what makes the caption survive that.
        ApplyWindowChrome("window created");
    }

    protected override void WndProc(ref Message m)
    {
        base.WndProc(ref m);

        // WM_SETTINGCHANGE: the user switched light/dark, turned high contrast on, changed the accent
        // or moved to another monitor. Windows re-themes the caption itself, so the decision is
        // re-made rather than assumed to still be right. Base runs first: it is what refreshes the
        // SystemInformation values the decision reads.
        if (m.Msg == WmSettingChange && IsHandleCreated)
            ApplyWindowChrome("system settings changed");
    }

    private void ApplyWindowChrome(string why)
    {
        // Never fatal: a refused DWM call leaves the caption Windows already drew.
        var result = WindowChrome.Apply(Handle);
        _chrome = result;
        Trace.WriteLine($"[meme-fryer] title bar ({why}): {result.Plan.Reason}; {result.Detail}");
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var parameters = base.CreateParams;
            if (_selfCheckReportPath is not null)
            {
                const int WsExNoActivate = 0x08000000;
                parameters.ExStyle |= WsExNoActivate;
            }

            return parameters;
        }
    }

    private async void OnLoaded(object? sender, EventArgs e)
    {
        try
        {
            await InitializeWebViewAsync();
        }
        catch (Exception ex)
        {
            Trace.WriteLine($"[meme-fryer] browser engine failed: {ex}");

            if (_selfCheckReportPath is not null)
            {
                // Never a modal dialog here: a self-check must stay off-screen and still report.
                Console.Error.WriteLine($"[meme-fryer] self-check failed: the browser engine did not start: {ex.Message}");
                await SelfCheck.WriteFailureAsync(_selfCheckReportPath, _appDir,
                    "the browser engine did not start", ex);
                Close();
                return;
            }

            MessageBox.Show(
                "The embedded browser could not start.\n\n" + ex.Message +
                "\n\nThe WebView2 Runtime (Microsoft Edge WebView2) must be installed. " +
                "It ships with Windows 11 and current Windows 10 updates.",
                "Bytefry — WebView2 unavailable",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            Close();
        }
    }

    private async Task InitializeWebViewAsync()
    {
        var userDataDir = AppPaths.ResolveUserDataDir();
        var environment = await CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,
            userDataFolder: userDataDir);

        await _webView.EnsureCoreWebView2Async(environment);

        var core = _webView.CoreWebView2;

        core.Settings.AreDevToolsEnabled = _dev;
        core.Settings.AreDefaultContextMenusEnabled = _dev;
        core.Settings.AreBrowserAcceleratorKeysEnabled = _dev;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = true;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsSwipeNavigationEnabled = false;

        // DenyCors: the app folder is readable from this origin and from nobody else.
        core.SetVirtualHostNameToFolderMapping(
            AppPaths.VirtualHost,
            _appDir,
            CoreWebView2HostResourceAccessKind.DenyCors);

        _bridge = new Bridge(this, _appDir, userDataDir, _dev, () => core.Environment.BrowserVersionString);

        core.WebMessageReceived += OnWebMessageReceived;
        core.NavigationStarting += OnNavigationStarting;
        core.NavigationCompleted += OnNavigationCompleted;
        core.NewWindowRequested += OnNewWindowRequested;
        core.PermissionRequested += OnPermissionRequested;

        // Must be registered before the first navigation so the page sees window.fryerHost.
        await core.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript.Source);

        core.Navigate($"https://{AppPaths.VirtualHost}/index.html");
        Trace.WriteLine($"[meme-fryer] navigated to https://{AppPaths.VirtualHost}/index.html -> {_appDir}");

        if (_selfCheckReportPath is not null)
            await RunSelfCheckAsync(core);
    }

    private async Task RunSelfCheckAsync(Microsoft.Web.WebView2.Core.CoreWebView2 core)
    {
        var code = 1;
        try
        {
            var loaded = await _firstNavigation.Task.WaitAsync(TimeSpan.FromSeconds(30));
            if (loaded)
            {
                code = await SelfCheck.RunAsync(core, this, _selfCheckReportPath!, _appDir);
            }
            else
            {
                Console.Error.WriteLine("[meme-fryer] self-check failed: the page did not finish loading within 30 seconds");
                await SelfCheck.WriteFailureAsync(_selfCheckReportPath!, _appDir,
                    "the page did not finish loading within 30 seconds", null);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[meme-fryer] self-check failed: {ex.GetType().Name}: {ex.Message}");
            await SelfCheck.WriteFailureAsync(_selfCheckReportPath!, _appDir,
                "the self-check did not complete", ex);
            code = 1;
        }

        // Close instead of exiting so WebView2 tears down its browser process cleanly.
        _selfCheckExitCode = code;
        Close();
    }

    /// <summary>Exit code for <c>--selfcheck</c>: 0 only after a passing report, otherwise 1.</summary>
    internal int SelfCheckExitCode => _selfCheckExitCode;

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (e.IsSuccess) _firstNavigation.TrySetResult(true);
        else
        {
            _firstNavigation.TrySetResult(false);
            Trace.WriteLine($"[meme-fryer] navigation failed: {e.WebErrorStatus}");
        }
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        var bridge = _bridge;
        if (bridge is null) return;

        var reply = await bridge.HandleAsync(e.WebMessageAsJson);
        if (reply is null) return;

        var core = _webView.CoreWebView2;
        if (core is null) return;

        core.PostWebMessageAsJson(reply);
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (IsAllowedUrl(e.Uri)) return;

        // Offline host: nothing leaves the bundled app. No shell hand-off, no redirects.
        e.Cancel = true;
        Trace.WriteLine($"[meme-fryer] blocked navigation: {e.Uri}");
    }

    private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        Trace.WriteLine($"[meme-fryer] blocked new window: {e.Uri}");
    }

    private void OnPermissionRequested(object? sender, CoreWebView2PermissionRequestedEventArgs e)
    {
        e.State = CoreWebView2PermissionState.Deny;
        e.Handled = true;
        Trace.WriteLine($"[meme-fryer] denied permission: {e.PermissionKind} ({e.Uri})");
    }

    private static bool IsAllowedUrl(string url)
    {
        if (string.IsNullOrEmpty(url)) return false;

        if (url.StartsWith($"https://{AppPaths.VirtualHost}/", StringComparison.OrdinalIgnoreCase) ||
            url.Equals($"https://{AppPaths.VirtualHost}", StringComparison.OrdinalIgnoreCase))
            return true;

        return url.StartsWith("about:", StringComparison.OrdinalIgnoreCase)
               || url.StartsWith("data:", StringComparison.OrdinalIgnoreCase)
               || url.StartsWith("blob:", StringComparison.OrdinalIgnoreCase);
    }
}
