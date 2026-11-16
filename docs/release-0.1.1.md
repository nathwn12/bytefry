# Bytefry 0.1.1 — release draft

**Release preparation notes.** This document records the planned contents and checks; consult the
repository's release page for the actual publication status and assets.

## Bytefry 0.1.1

The 0.1.0 application with a redesigned icon and an optional transparent PNG output. Deep-fry an
image in a Windows window: repeat-JPEG crush, a WebGL bulge and five filters, all running on your
machine, then save as JPEG, or as a transparent PNG when no JPEG pass is used. Still no analytics,
no account and no updater of its own.

## What changed since 0.1.0

- **Transparent PNG output.** An `Output` group offers JPEG (the default, unchanged) and PNG
  (transparency). PNG is available only with both JPEG options off, because one recompression pass
  makes every pixel opaque; it keeps the source's alpha through the CamanJS filters and the glfx
  bulge, and the saved file is a real PNG the host writes with a `.png` name. PNG keeps every row's
  own pixels and alpha: the JPEG-only edge smear is skipped, and the first and last row are restored
  after the sharpen kernel, which never writes them, so a transparent border and a two-row image
  both survive. While a crush pass is on, the PNG chip is disabled and a hint says why.
- The icon is a transparent Bytefry mark drawn from one vector source, `assets/icon.svg`: the
  background is whatever the icon sits on, not a ground baked into the image. The README shows the
  same file.
- `Assets/make-icon.py` rasterises that SVG into `Assets/MemeFryer.ico` at 16, 24, 32, 48, 64, 128
  and 256 px and writes `Assets/icon.lock`, the sha256 of both files. The window-free suite compares
  the lock with the files, so the icon checks stay red without Python when either side moves alone.
- `Assets/icon-source.png`, the opaque bitmap the previous icon was traced from, is gone.

Nothing else moved: the pipeline and its order, the 800 px working cap, the JPEG export rules, the
per-user installer, the portable layout, the bridge contract v1 and the GPL-3.0-only licence are the
ones shipped in 0.1.0.

## What is in it

- A WinForms host around Microsoft Edge WebView2 that serves the bundled web app from one virtual
  origin, denies CORS and cancels every navigation, new window and permission request that would leave
  it.
- The upstream processing pipeline in its original order: optional JPEG crush, the glfx bulge pinch,
  CamanJS brightness/contrast/sharpen/saturation/noise, optional second JPEG crush. Working width
  800 px; export JPEG at 0.8, or the quality slider when "after filters" is on, or a transparent PNG
  when both JPEG options are off.
- A rebuilt interface with no jQuery, analytics, ads or service worker, and an in-app licence dialog.
- A single-file portable build, or a per-user installer that needs no elevation. One `.ico` feeds the
  executable, the window and the setup file.
- Licence: GPL-3.0-only. The upstream licence file is the GNU GPL version 3 text with no "or later"
  grant, so that is the conservative reading; the upstream credit stays intact.

## Install

The installer is per-user: it needs no administrator rights. It keeps the `AppId` of 0.1.0, so an
existing install upgrades in place rather than appearing twice. Uninstall removes the program and
leaves the WebView2 profile folder in place, so a reinstall finds the state it had. The portable build
is the same executable with its `app\` folder beside it.

Requirements: Windows 10 or later, x64 or ARM64, and the Microsoft Edge WebView2 Runtime (present on
Windows 11). The default build is self-contained: the .NET 10 runtime travels inside the single
executable, so the machine needs no separate .NET install.

## Assets to attach

Build these from the tagged commit; do not attach a local build from an earlier tree. The names below
match the 0.1.0 release page. Internal names that keep the pre-rename spelling are listed in
[`naming.md`](naming.md).

| Asset | Produced by | Notes |
|---|---|---|
| `Bytefry-0.1.1-setup.exe` | `pwsh -File desktop/build.ps1 -Installer` | per-user installer, architecture follows the payload |
| `Bytefry-0.1.1-portable-x64-release.zip` | `pwsh -File desktop/build.ps1`, then archive the contents of `desktop\dist\portable\` | the archive must keep `app\` beside `Bytefry.exe` |

Record the SHA-256 of each attached file at upload time and paste the real values here; do not guess
them. Tag convention: `v0.1.1`.

## Corresponding source and build materials

GPL-3.0-only section 6 requires that a binary be accompanied by its Corresponding Source, conveyed
either alongside it or from a network server at the same place; section 1 defines that source as the
preferred form plus the scripts used to control compilation and installation. So this release rides on
a tag: the tag is the source, the same release page serves the tag's source archive, and no binary is
uploaded without it.

| What | How it is delivered | Notes |
|---|---|---|
| Corresponding Source for `v0.1.1` | The source archive GitHub generates for that tag, offered on the same release page (`Source code (zip)` and `Source code (tar.gz)`) | Generated from the tagged commit, not from a branch. The URL does not exist until the release is published; do not write one here before then |
| Optional curated archive | `Bytefry-0.1.1-source.zip`, built from the same commit with `git archive --format=zip --prefix=Bytefry-0.1.1/ <commit>` | The same tree as the tag archive, with nothing added or left out beyond the `--prefix` directory. If both are offered they must come from the identical commit |
| Rebuild route | `pwsh -File desktop/build.ps1 -Installer` from the root of the extracted archive | Needs the .NET SDK 10 and Inno Setup 6; produces an equivalent setup and portable folder, not a byte-identical reproduction — see below |

The archive carries everything needed to rebuild the binaries:

- `app/` — `index.html`, `styles.css`, `app.js`, `vendor/` (CamanJS, glfx.js), `LICENSE`, `ATTRIBUTION.md`, `README.md`.
- `desktop/` — `MemeFryer.Desktop/` (host sources, `MemeFryer.Desktop.csproj`, `app.manifest`, `Assets/` with the icon, `make-icon.py` and `icon.lock`), `installer/MemeFryer.iss`, `build.ps1`, `test.ps1`, `selfcheck-report.ps1`, `run-dev.ps1`, `NOTICE.md`, `README.md`.
- `assets/icon.svg` — the vector the `.ico` is generated from, and the image the README shows.
- `tests/` — the web-layer suite and its fixtures — plus the root `LICENSE`, `README.md`, `assets/`, `docs/` and `.github/workflows/ci.yml`.
- `third_party/camanjs/` and `third_party/glfx/` — the upstream source of both bundled libraries at the pinned commits, their licences, a `BUILD.md` recording how each artifact was produced, and a `verify.mjs` that checks the shipped bytes against them.

Both bundled libraries have their exact source in the tag, and both ship a file that upstream published
rather than one built here. For CamanJS the shipped bundle is the `dist` artifact of `caman` 4.1.2
(commit `36697e0`): after normalising line endings, `verify.mjs` matches it byte for byte. For glfx.js
the shipped file is the published `gh-pages` artifact up to one header line that the upstream build tool
itself changed in 2022, and upstream's `build.py` pipes the sources through whatever `closure` is on
`PATH`: neither the compiler nor its version is recorded upstream, so a byte-for-byte rebuild of that
bundle cannot be derived from the tree and is unverified. The artifact is pinned as a file; the source
is what explains it.

That has a consequence for this release: the source archive lets anyone rebuild an equivalent Bytefry,
but no byte-identical output is promised — not for `glfx.js`, not for the icon rendered through
whatever Pillow and numpy the rebuilder has, and not for the Windows binaries either.

Not conveyed, and not part of the Corresponding Source: the .NET 10 SDK and runtime, the
`Microsoft.Web.WebView2` package, and the WebView2 Runtime installed on the machine. They are
Microsoft's own components under their own licences; the pinned package version (`1.0.4314.35`) and the
scripts that consume them are in the archive, which is what the licence asks for.

The notices each binary must carry, and does carry: `NOTICE.md` at the root of the portable folder and
in the install directory, `app/LICENSE`, `app/ATTRIBUTION.md` and `app/vendor/NOTICE`, plus the in-app
`Licence` dialog. The installer copies the portable folder whole, so nothing is dropped on the way in.
Record at publish time, in this file: the commit SHA, the tag, the attached source archive name and its
SHA-256, and this notice list — as they actually are, not as planned.

## Checks to record before publishing

Run, in this order, and record the real output:

1. `node third_party/camanjs/verify.mjs` and `node third_party/glfx/verify.mjs` — offline and
   dependency-free: they prove the shipped `app/vendor/` bytes are the pinned upstream artifacts and that
   the source beside them is the source those artifacts came from.
2. `python desktop/MemeFryer.Desktop/Assets/make-icon.py --check` — the committed `.ico` is a fresh
   render of `assets/icon.svg`, and `icon.lock` agrees with both. Needs Python with Pillow and numpy;
   `desktop/test.ps1` performs the lock comparison without Python.
3. `pwsh -File desktop/test.ps1` — the window-free suite: bridge host, injected script in Node, packaging
   invariants (including the Bytefry identity and the icon), self-check report gate, and the command
   line's exit codes.
4. `node tests/run.mjs` — the web-layer suite, in headless Chrome with a throwaway profile and no window.
   It carries no wall-clock assertions, so a slow or busy machine cannot turn it red.
5. `pwsh -File desktop/build.ps1 -Installer` — build both packages without opening a window.

The opt-in `-Verify` self-check creates an off-screen window and is not headless. Native window and
Open/Save dialog behavior remain unverified under the headless-only constraint. Do not uninstall an
existing installation as part of verification.

`node tests/bench.mjs` is optional and not a gate: it prints where a load spends its time, and it fails
only if two scripts produce different bytes, never on a timing difference. Quote its numbers only from
the run recorded against the tagged commit, and quote none of them in the release notes.

## Known limits

- Unsigned: SmartScreen warns on a fresh download, and there is no auto-update.
- First launch of the single-file build is slower while the native WebView2 loader is extracted.
- The executable needs its `app\` folder: without it the app shows an error and exits 2.
- The bulge is WebGL. Where it is unavailable the control disables itself and the status line says so,
  rather than rendering something different.
- Transparency is PNG-only: one JPEG recompression pass makes every pixel opaque, so the PNG output is
  offered only with both JPEG options off. A JPEG source carries no alpha to keep.
- With sharpen on, a PNG's first and last row are the pre-filter row: the vendored kernel does not
  write them, and restoring the pixels is the only way to keep a border's own alpha.
- An upgraded install reuses the previous directory and overwrites the payload, so a superseded
  `MemeFryer.exe` can be left beside `Bytefry.exe`; deleting it by hand is safe.

## Credits and licence

Bytefry is a modified desktop build of **Meme Deep Fryer** by Dima and contributors
(<https://deepfriedmemes.com>, <https://github.com/efskap/deepfriedmemes.com>), which is licensed under
the GNU General Public License, version 3. The upstream licence file carries no "or later" grant, so this
release is distributed under the same terms as GPL-3.0-only; the full text ships in the app folder as
`LICENSE`, and the changes are itemised in `ATTRIBUTION.md`.
Bundled unchanged: CamanJS (BSD-3-Clause, 2010 Ryan LeFevre) and glfx.js (MIT, 2011 Evan Wallace).

## Publication checklist

- [ ] Owner approves the release text and the assets.
- [ ] Checks above run and recorded.
- [ ] `0.1.1` in `MemeFryer.Desktop.csproj`, `CHANGELOG.md` and this file agree, and the built
      executable reports that version.
- [ ] Tag `v0.1.1` pushed without moving `v0.1.0`, and the binaries attached together with that tag's
      source archive (or a curated source zip from the same commit) and real SHA-256 values.
- [ ] The 0.1.0 release stays as published: this is a new release, not a replacement.
- [ ] Release notes name the tag as the Corresponding Source and list the notices each binary carries:
      `NOTICE.md`, `app/LICENSE`, `app/ATTRIBUTION.md`, `app/vendor/NOTICE`, and the in-app dialog.
