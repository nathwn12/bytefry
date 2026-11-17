# desktop/ — the Windows host

A WinForms shell around Microsoft Edge WebView2 that loads `../app/index.html` from a local virtual
origin and gives the page a small native bridge for opening, saving and copying images. Everything is
offline: no host names resolve, no network request is made, and navigation away from the bundled app is
cancelled.

`app/` is a sibling of `desktop/` in source and is owned by another lane. This folder never writes to it;
the build copies it into the distributable.

| | |
|---|---|
| Host version | 0.1.1 (`MemeFryer.Desktop.csproj`); the executable is `Bytefry.exe` |
| Target | `net10.0-windows`, WinForms, x64 |
| Embedded engine | `Microsoft.Web.WebView2` 1.0.4314.35 (NuGet, pinned) |
| Runtime requirement | Microsoft Edge WebView2 Runtime (present on Windows 11; `157.0.4341.46` on the build machine) |
| Licence | GPL-3.0-only, matching `app/` — see `NOTICE.md` |

## Layout

```
desktop/
  MemeFryer.Desktop/          host source (folder and namespace keep the pre-rename name)
    Program.cs                entry, --selfcheck argument, dev flags
    MainForm.cs               window, WebView2 init, virtual host, navigation policy
    Bridge.cs                 request/reply host for open/save/copy
    AtomicSave.cs             temp-file-then-rename save: a failed write cannot truncate the target
    BridgeScript.cs           the injected JS half of the bridge (contract v1)
    SelfCheck.cs              off-screen verification, off-screen window, report writer
    AppPaths.cs               app folder, user-data folder, virtual host name
    app.manifest              per-monitor DPI, asInvoker, long paths
    Assets/MemeFryer.ico      generated icon, 16-256 px (exe resource, window icon, installer)
    Assets/make-icon.py       rebuilds that .ico from assets/icon.svg; --check gates drift
    Assets/icon.lock          sha256 of both files, compared by the suite with no Python
  tests/MemeFryer.Desktop.Tests/   window-free suite (bridge, script, packaging, CLI)
  installer/MemeFryer.iss     Inno Setup 6, per-user install, architecture from the build
  build.ps1                   publish + bundle app/ + NOTICE.md [+ installer] [+ off-screen check]
  test.ps1                    every window-free check, one command
  selfcheck-report.ps1        the one authority for "did the self-check pass"
  run-dev.ps1                 debug build against the source app/ (shows a window)
  NOTICE.md                   licence of the combined work + the components in the exe
  dist/                       build output (gitignored)
```

## Commands

```powershell
# every window-free check: C# suite + the self-check report gate
pwsh -File desktop/test.ps1

# portable build: dist\portable\Bytefry.exe + dist\portable\app\  (self-contained, single file)
pwsh -File desktop/build.ps1

# installer as well: dist\installer\Bytefry-0.1.1-setup.exe
pwsh -File desktop/build.ps1 -Installer

# smaller exe that needs the .NET 10 Desktop Runtime installed
pwsh -File desktop/build.ps1 -FrameworkDependent

# opt-in off-screen end-to-end run (creates a window outside every monitor; see below)
pwsh -File desktop/build.ps1 -Verify

# debug host against the source tree (this one shows a window)
pwsh -File desktop/run-dev.ps1
```

`-Runtime win-arm64` publishes and packages ARM64; the installer architecture follows the payload
(`x64compatible` or `arm64`), and the build fails if the PE machine of `Bytefry.exe` does not match
the requested runtime.

Observed on this machine, Release:

| Build | `Bytefry.exe` | Total folder |
|---|---|---|
| self-contained, single file, x64 (default) | 47.6 MB | 47.8 MB with `app/` |
| self-contained, single file, arm64 | 46.4 MB | 46.6 MB with `app/` |
| framework-dependent, single file | 1.9 MB | 2.1 MB with `app/` |
| Inno Setup installer (x64 payload) | — | 42.9 MB |

`-AllowMissingApp` publishes the host shell while `app/index.html` does not exist yet.

## What is verified, and how

`desktop/test.ps1` is window-free: no Form, no WebView2, no message box. It covers the bridge host
(`hostInfo`, `saveImage` for data URLs, bare base64, `charset` parameters and wrapped base64, directory
creation, undecodable payloads, unknown commands, malformed messages, id echo), app-folder resolution
(override, beside-the-exe, six-level walk up, the failure message, user-data folder), the self-check
report writer, the injected script (surface, `node --check`, and behaviour in Node against a fake
`chrome.webview`: id correlation, concurrent calls, rejection, ignored stray replies, ready event), the
save path (a destination another handle holds, an injected failure part way through the write, a file
that appears after the name was chosen, a free name that must stay free on failure, the staging
location and the cleanup, a replacement that must keep the destination's own metadata, an attribute
that refuses the replacement, an existing folder as the target, the staging file's own ACL and the
folder permissions a created file gets back, a declined confirmation, and a file changed or swapped
after the confirmation), the packaging invariants, and the host's command line (`--help` → 0,
`--selfcheck` without a path → 64, missing app bundle → 2 — all three returns happen before a window
exists).

`Bytefry.exe --selfcheck <report.json>` is the end-to-end route: real WebView2 environment, virtual
host, injected bridge, message round trip, real file write, real navigation guard. It needs a real window
for WebView2 to compose, so it parks one at `-32000,-32000`, out of the taskbar and never activated
(`WS_EX_NOACTIVATE`): nothing is visible and no focus is taken, but **it is off-screen, not headless** —
a window object does exist. It is therefore opt-in via `-Verify` and never run by `test.ps1`.

Two things no automated check here establishes: how the rendered pixels look, and how the native
Open/Save dialogs render — a dialog is a separate native window. Both need a human look.

`-Verify` trusts nothing but a report that exists, parses, says `passed=true`, has at least one check,
has no failing check, and agrees with a zero exit code (`selfcheck-report.ps1`). `test.ps1` feeds that
gate seven fabricated reports to prove each rule still rejects.

## Bridge contract, version 1

`BridgeScript.Source` is injected before any page script runs, so `window.fryerHost` exists
synchronously at the top of `app.js`.

| Member | Result |
|---|---|
| `fryerHost.available` | `true` in the host; `false` in a plain browser, where the same members exist as stubs that throw |
| `fryerHost.version` | `1` |
| `fryerHost.hostInfo()` | `{ host, platform, arch, bridge, hostVersion, browserVersion, framework, os, dev, appDir, userDataDir, origin }` |
| `fryerHost.openImage({ title?, filter? })` | `{ name, path, mime, size, lastModified, dataUrl }`, or `null` when the user cancels |
| `fryerHost.saveImage({ dataUrl \| base64, mime?, suggestedName?, path?, title?, filter? })` | `{ path, size, mime }`, or `null` when the user cancels a dialog |
| `fryerHost.copyImage({ dataUrl })` | `{ ok, width, height }`; also copies the bitmap to the clipboard |

Notes both lanes depend on:

- Rejections are `Error` objects with the host's message; an unknown command rejects too.
- `saveImage` replaces an existing file only for a file it can still recognise, and asks first. The
  bytes are staged in a uniquely named temporary beside the destination (`AtomicSave.cs`), flushed,
  and committed by one rename, so a failed write, a full disk or a destination another program is
  holding leaves the previous image exactly as it was and never leaves a temporary behind. The
  staging file is created with its own ACL — the current user and LOCAL SYSTEM only, nothing
  inherited — so a half-written image in a shared, public or synchronised folder is not readable by
  that folder's other accounts; a newly created destination gets the folder's inherited permissions
  back when the save finishes, and a replaced one keeps its own. The destination is read once, when
  the path is chosen (existence, file index, length, write time), and the commit refuses anything that
  no longer matches it: a name that was free and is now taken, a different file at the same path, or a
  file edited after the confirmation. With a `path` the caller names the file (the self-check's unique
  name, a batch export) and nothing is asked. Without one, the Save dialog picks the name with its own
  overwrite prompt off, and Bytefry asks instead — after reading the file — so the answer belongs to a
  file it can recognise. `suggestedName` is sanitised and the extension is added from `mime`.
- Images cross the boundary as base64 `data:` URLs, so the page needs no file-system access and the
  host needs no image codec beyond the clipboard path.
- `openImage` returns the bytes, not a `file://` URL: the app folder is the only folder the virtual host
  maps, so a path outside it would not be readable by the page.
- A `fryerhostready` event is dispatched in both modes — the host and the plain-browser fallback — after
  `fryerHost` is assigned. It fires before app scripts attach their listeners, so test `fryerHost`
  directly rather than waiting for it.

## Host policy

- Virtual origin `https://meme-fryer.local/`, mapped with `DenyCors`, serving `app/` only.
- Every navigation outside that origin, every new window and every permission request is refused.
  Links inside the app (the attribution dialog) therefore do nothing — deliberate for an offline build.
- Devtools, context menus and browser accelerators are off unless `MEME_FRYER_DEV=1` (set by `run-dev.ps1`).
- User data lives in `%LOCALAPPDATA%\MemeFryer\WebView2`, never beside the exe, so a read-only install
  folder is fine; `MEME_FRYER_USER_DATA_DIR` overrides it. The folder keeps its pre-rename name on
  purpose: an installed copy already has its profile there, so the rename needed no migration.
- App folder resolution: `MEME_FRYER_APP_DIR`, then `app\` beside the exe, then a bounded walk up the
  source tree to the repo root that holds `app\` beside `desktop\`.
- One process, one window, `asInvoker`. No registry writes, no services, no scheduled tasks. The
  per-user Apps & Features entry belongs to the installer, not to the host.

## What the save can and cannot promise

The file that is replaced is the file the confirmation named: the identity is read before the question
is asked, and the commit refuses if it no longer matches. Three limits are stated rather than papered
over:

- Between the commit's identity check and the rename itself — microseconds, inside one sequence of
  system calls — a file can still be swapped. Windows offers no rename that also asserts the target's
  identity, so that window is irreducible; it is no longer the length of a dialog session.
- On filesystems that report no file index (some SMB shares), identity falls back to length and write
  time, so a same-length, same-timestamp swap would pass.
- The staging ACL protects the write window from other *account* readers. It cannot protect against a
  local administrator, who can take ownership of any file regardless of its ACL.

## Packaging notes and limits
- Single-file publish extracts the native WebView2 loader into the .NET single-file cache on first run;
  the first launch is therefore slower than later ones.
- The self-check writes its probe file under a name that cannot already exist
  (`selfcheck-write-<guid>.png`) and deletes only that file, so a run never removes or overwrites
  anything of the user's.
- The icon is drawn, not default: `assets/icon.svg` is the one source, and
  `Assets/make-icon.py` rasterises it into `Assets/MemeFryer.ico` at 16, 24, 32, 48, 64, 128 and
  256 px. That one .ico feeds the exe's Win32 resource, the window icon and the installer, and the
  README shows the same SVG, so the four cannot drift apart. Every build also writes
  `Assets/icon.lock`, the sha256 of both files; the suite compares it with the files directly, so
  editing the SVG or replacing the .ico without re-running the generator turns the icon checks red
  on a machine with no Python at all. `--check` is the same comparison plus a full re-render. What
  is still missing is code signing, auto-update and an `AppUserModelID`, so SmartScreen will warn on
  a fresh download until it is signed.
- The installer is per-user (`PrivilegesRequired=lowest`, `{localappdata}\Programs`), does not require
  elevation, and keeps its pre-rename `AppId` so an existing install upgrades in place. It writes no
  `[UninstallDelete]` entry: uninstalling leaves `%LOCALAPPDATA%\MemeFryer` (the WebView2 profile and
  its UI state) where it is, and removing that folder stays the user's decision. The pre-rename build
  deleted it.
- An upgraded install reuses the previous directory and overwrites the payload, so the superseded
  `MemeFryer.exe` can be left behind beside `Bytefry.exe`. It still runs (it finds the same `app\`), it
  is simply no longer the executable the shortcut, the installer or the uninstall entry names. Nothing
  deletes it automatically; deleting it by hand is safe.
- Nothing here is published or installed by the build; `dist/` is local output only.
- GPL-3.0-only obligations: any binary distribution must ship or offer the corresponding source
  (`desktop/` and `app/`) and the notices the bundle carries (`NOTICE.md`, `app/LICENSE`,
  `app/ATTRIBUTION.md`, `app/vendor/NOTICE`). The licence is version 3 only, not "or later": the
  upstream work grants no later-version option, so this build claims none. See `NOTICE.md`.

## Names that stay

The rename is about what a user sees. These keep the pre-rename name because changing them would break
something else, and none of them is visible in the product:

| Kept | Why |
|---|---|
| `%LOCALAPPDATA%\MemeFryer\WebView2` | an installed copy's WebView2 profile; renaming it needs a migration, not an edit |
| Installer `AppId` `{B4F1C8A2-…}` | Windows' identity for upgrade and uninstall; a new GUID would orphan an existing install |
| `MEME_FRYER_DEV`, `MEME_FRYER_APP_DIR`, `MEME_FRYER_USER_DATA_DIR` | configuration contract already documented in the root README and used by scripts |
| Virtual origin `https://meme-fryer.local/` | the app lane's `app/README.md` documents it, and it is internal to the WebView2 mapping |
| Bridge `host: "meme-fryer-desktop"` and `[meme-fryer]` trace prefix | bridge contract v1 identity the app lane may key on; diagnostics only |
| Project folders, `RootNamespace`, `MemeFryer.Desktop.Tests`, `MemeFryer.ico`, `MemeFryer.iss` | build-internal paths: nothing a user installs, opens or reads is named by them |
