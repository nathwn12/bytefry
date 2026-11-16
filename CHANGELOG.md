# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1]

The icon change only: the host, the processing pipeline, the bridge contract and
the packaging are those of 0.1.0.

### Changed

- The icon is a transparent Bytefry mark drawn from one vector source,
  `assets/icon.svg`, so the background is whatever the icon sits on rather than a
  ground baked into the image. That one file is also what the README shows.
- `Assets/make-icon.py` rasterises that SVG into `Assets/MemeFryer.ico` at 16, 24,
  32, 48, 64, 128 and 256 px and writes `Assets/icon.lock`, the sha256 of both
  files. The window-free suite compares the lock with the files directly, so the
  checks stay red on a machine with no Python when either side is edited without
  the other; `--check` is that comparison plus a full re-render.
- One `.ico` still feeds the executable's Win32 resource, the window icon and the
  installer, and the suite now proves each frame is well formed, fully
  transparent at its edges, and the app's own palette.

### Removed

- `Assets/icon-source.png`, the opaque bitmap the previous icon was traced from.

## [0.1.0]

The executable, the window title, the product metadata and the installer display
name are Bytefry. The data folder, the virtual host name and the environment
variables keep the pre-rename names (`MemeFryer`, `meme-fryer.local`,
`MEME_FRYER_*`), because a shipped install already owns them.

### Added

- A Windows host: one WinForms shell around one WebView2 view, built as
  `Bytefry.exe` with an `app\` folder beside it.
- The web layer it serves: plain HTML, CSS and JavaScript with no jQuery, no
  analytics and no service worker.
- The upstream pipeline in the upstream order: an optional JPEG crush, the glfx
  bulge over those pixels, CamanJS filters (brightness, contrast, sharpen,
  saturation, noise), then an optional JPEG crush again. The 800 px canvas cap and
  the per-pass quality jitter are upstream behaviour.
- Crush controls: 28 passes at 0.175 quality by default, placed before the
  filters, after them, or both.
- Bulge points: click to add one, drag to move it, arrow keys to nudge it by 1%
  of the image, `Delete` to remove it, `Enter` to re-render.
- Editing keys: `Ctrl+O` opens an image, `Ctrl+V` pastes one from the clipboard,
  `Ctrl+S` saves the result. Save and Copy refuse while a render is running or a
  point is being dragged, so a half-finished canvas is never encoded.
- No network surface: the page declares `connect-src 'none'`, and the host
  cancels navigation, new windows and permission requests outside its own virtual
  origin.
- Packaging: a self-contained single-file build (`desktop/build.ps1`), a per-user
  installer that needs no elevation (`-Installer`), `win-arm64` output, and a
  check that fails when the executable's PE machine disagrees with the requested
  runtime.
- An off-screen self-check: `--selfcheck <report.json>` runs the host outside
  every monitor and writes a JSON report, which `desktop/selfcheck-report.ps1`
  accepts only when it parses, reports `passed: true`, carries no failing check,
  and agrees with a zero exit code.
- Tests: a window-free C# suite plus that report gate (`desktop/test.ps1`), a
  deterministic headless web-layer suite (`node tests/run.mjs`), and an opt-in
  measurement of the load path (`node tests/bench.mjs`).
- GPL-3.0-only, with the upstream attribution in `app/ATTRIBUTION.md` and the
  vendored-library notices beside the vendored files.
