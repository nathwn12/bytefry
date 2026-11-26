<p align="center">
  <img src="assets/icon.svg" width="120" height="120" alt="Bytefry icon" />
</p>

<h1 align="center">Bytefry</h1>

<p align="center"><strong>Deep-fry an image on Windows: repeat JPEG crush, a bulge and five filters, all on your machine, then save.</strong></p>

<p align="center">
  <img src="assets/screenshot.png" alt="Bytefry editor showing the image drop area, filter sliders, JPEG settings and bulge control" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-windows--64bit-2b3137?logo=windows&logoColor=white" alt="Platform" />
  <img src="https://img.shields.io/badge/filters-5-brightgreen" alt="5 filters" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-green" alt="GPL-3.0" /></a>
</p>

## Why bytefry

Bytefry is a desktop build of *Meme Deep Fryer*: the original image pipeline, running offline in a WinForms window around Microsoft Edge WebView2. Nothing leaves the machine — the page declares `connect-src 'none'`, and the host cancels every navigation, new window and permission request.

- **Offline by policy.** No fonts, no analytics, no service worker, no network calls from the page.
- **The original pipeline.** JPEG crush before and after the filters, a WebGL bulge, then brightness, contrast, sharpen, saturation and noise.
- **A real window.** Open, paste and save through native dialogs, with a working canvas capped at 800 px.
- **No runtime to install.** .NET 10 travels inside the executable; only WebView2 is needed.

## Install

Take the installer or the portable build from [releases](https://github.com/nathwn12/bytefry/releases/latest).

- The installer is per-user: no administrator rights, and a newer version upgrades in place. It registers the Apps & Features entry that a newer version replaces and that removes the app.
- The portable build is `Bytefry.exe` with its `app\` folder beside it; keep the two together.
- Or build it from source, which needs the .NET SDK 10 — see [Development](#development).

## Use it

1. Open an image: `Ctrl+O`, paste one with `Ctrl+V`, or drop a file on the stage.
2. Set the filters. Brightness, contrast, sharpen, saturation and noise re-render on release.
3. Choose where the JPEG crush runs: before the filters, after them, or both.
4. Enable bulge, click the image to add a point, drag it to move. Global strength and radius apply to every point.
5. Save with `Ctrl+S`, or copy the result to the clipboard.

Save and Copy refuse while a render is running or a point is being dragged, so a half-finished canvas is never encoded. The full key list is in [`app/README.md`](app/README.md).

## Configure it

Settings live in the window as sliders and checkboxes; there is no config file. Defaults below come from the shipped markup:

| Setting | Default | Range |
| --- | --- | --- |
| JPEG repetitions | 28 | 1–200, when a crush pass is on |
| JPEG quality | 0.175 | 0–0.5, step 0.025 |
| Brightness | 15 | -10–30 |
| Contrast | 155 | 0–300 |
| Sharpen | 83 | 0–800 |
| Saturation | 0 | 0–300 |
| Noise | 18 | 0–100 |
| Bulge global strength | 0.7 | -1–1, step 0.05 |
| Bulge global radius | 0.2 | 0–1, step 0.05 |

Working width is capped at 800 px. Export is JPEG at quality 0.8 unless the "after filters" pass is on, in which case the quality slider value is used.

## Requirements

- Windows 10 or later, x64 or ARM64.
- Microsoft Edge WebView2 Runtime, which Windows 11 already has.
- The default build needs no .NET runtime: .NET 10 travels inside the executable.
- To build: the .NET SDK 10, and Inno Setup 6 only for the installer.
- Nothing is code-signed, so SmartScreen warns on a fresh download, and there is no auto-update.
- The first launch of the single-file build is slower: the native WebView2 loader is extracted into the .NET cache on first run.

## Development

```sh
node desktop/build.mjs                # desktop/dist/portable/Bytefry.exe with app/ beside it
node desktop/build.mjs --installer    # plus desktop/dist/installer/Bytefry-<version>-setup.exe
node desktop/build.mjs --verify       # the same build plus the off-screen self-check
node tests/run.mjs                    # web-layer suite in headless Chrome, no window
node third_party/camanjs/verify.mjs   # the shipped CamanJS bytes are the pinned upstream artifact
node third_party/glfx/verify.mjs      # the same for glfx.js
```

`node tests/run.mjs` is the gate: no wall-clock assertions, so a busy machine cannot turn it red. `--verify` needs a real window for WebView2 to compose, so it parks one outside every monitor and never activates it. Node 22 or newer runs the web-layer suite. The full command set, release target and icon check are in the repo's own notes.

## Status

**Active** — maintained, issues welcome.

## Links

- [Issues](https://github.com/nathwn12/bytefry/issues)
- [Releases](https://github.com/nathwn12/bytefry/releases)
- [`app/README.md`](app/README.md)
- [`desktop/README.md`](desktop/README.md)
- [`CHANGELOG.md`](CHANGELOG.md)
- [Meme Deep Fryer](https://deepfriedmemes.com)
- [GitHub](https://github.com/efskap/deepfriedmemes.com)
- [GPL-3.0-only](LICENSE)

<p align="center"><sub>Built by nathwn12</sub></p>
