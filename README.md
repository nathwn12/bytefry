<p align="center">
  <img src="assets/icon.svg" width="120" height="120" alt="Bytefry icon" />
</p>
<h1 align="center">Bytefry</h1>
<p align="center"><strong>Deep-fry an image in a Windows window: repeat-JPEG crush, a WebGL bulge and five filters, all running on your machine, then save.</strong></p>

## Install

Download the Windows x64 portable archive or installer from the repository's releases, or build locally using the commands below. Keep `app\` beside the executable: the host serves that folder and nothing else.

```powershell
# portable build -> desktop\dist\portable\Bytefry.exe, with app\ beside it
pwsh -File desktop/build.ps1

# the same build plus a per-user installer -> desktop\dist\installer\Bytefry-<version>-setup.exe
pwsh -File desktop/build.ps1 -Installer
```

The portable folder is self-contained: it carries the .NET 10 runtime inside the single executable, so the machine needs only the Microsoft Edge WebView2 Runtime. The installer ships that same payload per user.

The executable, the setup file, the window title, the in-app title and the uninstall entry all say Bytefry. A few internal names keep the pre-rename spelling — the `MEME_FRYER_*` variables below, the WebView2 profile folder, `meme-fryer.local` — and [`docs/naming.md`](docs/naming.md) says which ones stay and why.

### Offline or pinned

Editing happens in the window, on your machine. The page declares `connect-src 'none'`, `form-action 'none'`, `object-src 'none'` and `base-uri 'none'`, so a fetch, socket or form post from the page fails instead of silently succeeding; the host cancels every navigation, new window and permission request that would leave its own virtual origin. There is no analytics, no account, no external image service and no updater of its own: the filters and the JPEG passes run in the page's canvas and WebGL context, and the image you open and the file you save are read and written by the window itself. The embedded browser engine is Windows' own WebView2 Runtime, which Microsoft updates separately from this app.

- Smaller executable that needs the .NET 10 Desktop Runtime: `pwsh -File desktop/build.ps1 -FrameworkDependent`.
- There is no feed to pin. The one version that matters is `Microsoft.Web.WebView2` in `desktop/MemeFryer.Desktop/MemeFryer.Desktop.csproj`, currently `1.0.4314.35`.
- To run the web layer with no Windows host at all, open `app/index.html` in a Chromium-based browser. It falls back to a file input and a download link.

## Use it

1. Open an image: `Ctrl+O`, paste one with `Ctrl+V`, or drop a file on the stage.
2. Set the filters. Brightness, contrast, sharpen, saturation and noise each re-render on release.
3. Choose where the JPEG crush runs: before the filters, after them, or both. Repetitions default to 28 at quality 0.175.
4. Choose the output: **JPEG**, or **PNG (transparency)** when both JPEG options are off. A transparent source keeps its alpha only in PNG.
5. Enable bulge, then click the image to add a point and drag it to move. Global strength and radius apply to every point.
6. Save with `Ctrl+S`, or copy the result to the clipboard.

The working canvas is capped at 800 px wide. The JPEG export is 0.8 quality unless "after filters" is on, in which case it uses the quality slider. PNG is lossless and is offered only with both JPEG options off, because one JPEG recompression makes every pixel opaque.

| Keys | Action |
|---|---|
| `Ctrl+O` | open an image |
| `Ctrl+S` | save the result |
| `Ctrl+V` | paste an image from the clipboard |
| arrow keys | nudge the focused bulge point by 1% of the image |
| `Delete` | remove the focused bulge point |
| `Enter` | re-render after a keyboard nudge |

## What you get

- **The original pipeline, in the original order.** Optional JPEG crush, the glfx bulge pinch over those pixels, CamanJS filters, optional JPEG crush again. The constants, the 800 px cap and the per-pass quality jitter come from the upstream project unchanged.
- **Transparent PNG when the crush is off.** With both JPEG options off, the output switches to PNG and the source's alpha survives the filters and the bulge, so a cut-out stays a cut-out. JPEG has no alpha channel, so while a crush pass runs the PNG option is refused and the export stays the JPEG it always was.
- **A rebuilt interface.** The page is plain HTML, CSS and JavaScript with no jQuery, no analytics, no ads and no service worker; the layout is a dark workbench with the stage on the left and grouped controls on the right.
- **Export you cannot trip.** Save, Copy and `Ctrl+S` refuse while a render is running or a point is being dragged, because the canvas is exportable only when it holds a finished render. A drag paints a preview, and the preview is never encoded.
- **Everything local.** The host maps one folder to one virtual origin, denies CORS and cancels anything that would leave it; the page cannot open a connection and runs no analytics. Both the render and the encode happen in the window, with no service on the other end.
- **Portable and installed.** A single executable with `app\` beside it, or a per-user installer that needs no elevation. Uninstalling removes the program and leaves the WebView2 profile folder in place, so a reinstall finds the state it had.
- **The licence in the app.** The `Licence` button opens the attribution dialog; the full GPL version 3 text ships as `app/LICENSE`, along with `NOTICE.md`, `app/ATTRIBUTION.md` and `app/vendor/NOTICE`. The upstream licence file grants version 3 only, and this build makes no broader grant. The same licence requires any binary release to carry its corresponding source — the release tag's source archive — and `desktop/build.ps1` builds its binaries from that tree. CamanJS and glfx.js travel with their upstream source and a verifier under `third_party/`; a rebuild produces an equivalent build, not a byte-identical one — `glfx.js` itself was compiled with a Closure version that upstream never recorded.

## Configure it

| Setting | Where | Default | What it does |
|---|---|---|---|
| `MEME_FRYER_DEV` | environment | unset | `1` turns devtools, context menus and browser accelerators back on |
| `MEME_FRYER_APP_DIR` | environment | `app\` beside the executable | serves a different web-app folder, which must contain `index.html` |
| `MEME_FRYER_USER_DATA_DIR` | environment | a per-user folder the host creates | moves the WebView2 profile; the folder is created if it is missing |

```powershell
$env:MEME_FRYER_DEV = '1'
$env:MEME_FRYER_USER_DATA_DIR = '.\profile'
.\Bytefry.exe
```

Nothing is written to the registry, no service or scheduled task is installed, and the process runs as the invoking user.

## Build and test

```powershell
node third_party/camanjs/verify.mjs        # shipped CamanJS bytes are the pinned upstream artifact
node third_party/glfx/verify.mjs           # the same for glfx.js, plus the source they came from
python desktop/MemeFryer.Desktop/Assets/make-icon.py --check   # the .ico is a fresh build of assets/icon.svg
pwsh -File desktop/test.ps1                 # window-free suite: bridge, injected script, packaging, CLI
pwsh -File desktop/build.ps1 -Verify        # the same build plus the off-screen self-check
pwsh -File desktop/run-dev.ps1              # Debug host against the source app/
node tests/run.mjs                          # web-layer suite in headless Chrome, no window
node tests/run.mjs export-lock              # one test by name: drop-safety, load-parity, export-lock, export-failure, transparency
node tests/bench.mjs                        # optional: reports where a load spends its time; never a gate
.\Bytefry.exe --help                        # usage, exit 0
.\Bytefry.exe --selfcheck .\report.json     # exit 0 only when the report exists, parses and passed
```

The icon is one vector source, `assets/icon.svg`, shown at the top of this page and rasterised into `desktop/MemeFryer.Desktop/Assets/MemeFryer.ico` by `make-icon.py` at 16, 24, 32, 48, 64, 128 and 256 px. Windows takes that one file three ways: the executable's Win32 icon resource, the window icon and the installer. `--check` compares the committed `.ico` with a fresh build and exits non-zero on any difference, and `--preview <dir>` writes every frame plus a light/dark contact sheet for a human to judge. It needs Python with Pillow and numpy; the rest of the build does not.

`node tests/run.mjs` is the gate: correctness checks with no wall-clock assertions, so a busy machine cannot turn it red. `node tests/bench.mjs` is the measurement, opt-in and numbers only; it exits non-zero only if two scripts produce different bytes, and a timing difference is never a failure. The two `third_party/*/verify.mjs` scripts are offline too: they match the shipped `app/vendor/` files against the pinned upstream artifacts and check that the source kept beside them is the source those artifacts came from.

`-Verify` needs a real window for WebView2 to compose, so it parks one outside every monitor with `WS_EX_NOACTIVATE`: nothing is visible and no focus is taken, but it is off-screen, not headless. It is opt-in and `desktop/test.ps1` never runs it.

`pwsh -File desktop/build.ps1 -Runtime win-arm64` publishes ARM64, the installer architecture follows the payload, and the build fails when the executable's PE machine disagrees with the requested runtime.

## Requirements

- Windows 10 or later, x64 or ARM64.
- Microsoft Edge WebView2 Runtime, present on Windows 11.
- No .NET runtime for the default self-contained build; `-FrameworkDependent` needs the .NET 10 Desktop Runtime.
- To build: the .NET SDK 10, PowerShell 7, and Inno Setup 6 when you pass `-Installer`.
- For the web-layer suite: Node 22 or newer, which the injected-script check and `node tests/run.mjs` need for a global `WebSocket`.

## Known limits

- Nothing is code-signed, so SmartScreen warns on a fresh download, and there is no auto-update.
- The first launch of the single-file build is slower than later ones: the native WebView2 loader is extracted into the .NET single-file cache on first run.
- The automated suite is window-free. How the rendered pixels look, and how the native Open and Save dialogs draw, need a human look.
- The executable without `app\` shows an error dialog and exits 2.
- Transparency is PNG-only. Any JPEG crush pass flattens alpha, so the PNG option is unavailable while one is on; a JPEG source has no transparency to keep.

## Status

Experimental and still moving. It works today, but it is not a finished
product: interfaces may change, features may be improved or removed, and a
release can break the one before it. This is maintained by one person, not a
team. If it breaks, open an issue with the command you ran and what you saw.

## Links

- Upstream: [Meme Deep Fryer](https://deepfriedmemes.com) by [Dima](https://dmitry.lol) and contributors, [source on GitHub](https://github.com/efskap/deepfriedmemes.com)
- [GPL-3.0-only](LICENSE)

<!-- nathwn12 house footer: identical in every repo. Do not edit. -->
<p align="center">
  <a href="https://github.com/nathwn12"><img src="assets/signature.svg" width="96" alt="nathwn12" /></a>
</p>
<p align="center">
  <sub>Built by <a href="https://github.com/nathwn12">nathwn12</a> · <a href="https://github.com/nathwn12?tab=repositories">All projects</a></sub>
</p>
