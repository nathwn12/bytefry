<p align="center">
  <img src="assets/icon.svg" width="120" height="120" alt="Bytefry icon" />
</p>
<h1 align="center">Bytefry</h1>
<p align="center"><strong>Deep-fry an image in a Windows window: repeat-JPEG crush, a WebGL bulge and five filters, all on your machine, then save.</strong></p>

<p align="center">
  <img src="assets/screenshot.png" alt="Bytefry editor on Windows, showing the image drop area, filter sliders, JPEG settings and bulge control" />
</p>

Bytefry is a desktop build of *Meme Deep Fryer*: the original image pipeline, running offline in a
WinForms window around Microsoft Edge WebView2. Nothing leaves the machine: the page declares
`connect-src 'none'`, and the host cancels every navigation, new window and permission request.

## Install

Take the installer or the portable build from [releases](https://github.com/nathwn12/bytefry/releases/latest).

- The installer is per-user: no administrator rights, and a newer version upgrades in place. It registers the Apps & Features entry that a newer version replaces and that removes the app.
- The portable build is `Bytefry.exe` with its `app\` folder beside it; keep the two together.
- Or build it from source, which needs the .NET SDK 10 — see [Development](#development).

## Use it

1. Open an image: `Ctrl+O`, paste one with `Ctrl+V`, or drop a file on the stage.
2. Set the filters. Brightness, contrast, sharpen, saturation and noise re-render on release.
3. Choose where the JPEG crush runs: before the filters, after them, or both. Defaults: 28 passes at quality 0.175.
4. Enable bulge, click the image to add a point, drag it to move. Global strength and radius apply to every point.
5. Save with `Ctrl+S`, or copy the result to the clipboard.

The working canvas is capped at 800 px wide, and Save and Copy refuse while a render is running or a
point is being dragged, so a half-finished canvas is never encoded. The full key list is in
[`app/README.md`](app/README.md).

## Requirements

- Windows 10 or later, x64 or ARM64.
- Microsoft Edge WebView2 Runtime, which Windows 11 already has.
- The default build needs no .NET runtime: .NET 10 travels inside the executable.
- To build: the .NET SDK 10, and Inno Setup 6 only for the installer.
- For the web-layer suite: Node 22 or newer.
- Nothing is code-signed, so SmartScreen warns on a fresh download, and there is no auto-update.
- The first launch of the single-file build is slower: the native WebView2 loader is extracted into the .NET cache on first run.

## Development

```sh
node desktop/build.mjs                # desktop/dist/portable/Bytefry.exe with app/ beside it
node desktop/build.mjs --installer    # plus desktop/dist/installer/Bytefry-<version>-setup.exe
node desktop/build.mjs --verify       # the same build plus the off-screen self-check
node desktop/test.mjs                 # window-free suite: bridge, injected script, packaging, CLI
node desktop/run-dev.mjs              # debug host against the source tree (opens a window)
node tests/run.mjs                    # web-layer suite in headless Chrome, no window
node third_party/camanjs/verify.mjs   # the shipped CamanJS bytes are the pinned upstream artifact
node third_party/glfx/verify.mjs      # the same for glfx.js
python desktop/MemeFryer.Desktop/Assets/make-icon.py --check   # the .ico is a fresh render of the icon
```

`node tests/run.mjs` is the gate: no wall-clock assertions, so a busy machine cannot turn it red.
`node tests/bench.mjs` measures instead, and fails only on a byte difference. `--verify` needs a real
window for WebView2 to compose, so it parks one outside every monitor and never activates it: nothing
is visible, but it is off-screen rather than headless, which is why it stays opt-in. The icon check
needs Python with Pillow and numpy; nothing else does.

## Status

**Active** — maintained, issues welcome.

## Links

- [Issues](https://github.com/nathwn12/bytefry/issues)
- [Releases](https://github.com/nathwn12/bytefry/releases)
- [`app/README.md`](app/README.md) — the web layer: pipeline order, keys, offline rules
- [`desktop/README.md`](desktop/README.md) — the host: bridge contract, policy, packaging, the save's limits
- [`CHANGELOG.md`](CHANGELOG.md) — what changed in each version
- Upstream: [Meme Deep Fryer](https://deepfriedmemes.com) by [Dima](https://dmitry.lol) and contributors, [source on GitHub](https://github.com/efskap/deepfriedmemes.com)
- Licence: [GPL-3.0-only](LICENSE)
