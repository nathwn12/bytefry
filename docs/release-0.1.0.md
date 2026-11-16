# Bytefry 0.1.0 — release draft

**Release preparation notes.** This document records the planned contents and checks; consult the
repository's release page for the actual publication status and assets.

## Bytefry 0.1.0

Deep-fry an image in a Windows window: repeat-JPEG crush, a WebGL bulge and five filters, all running on
your machine, then save. The first release is the desktop host and the rebuilt interface — no analytics,
no account, no updater of its own.

## What is in it

- A WinForms host around Microsoft Edge WebView2 that serves the bundled web app from one virtual
  origin, denies CORS and cancels every navigation, new window and permission request that would leave
  it.
- The upstream processing pipeline in its original order: optional JPEG crush, the glfx bulge pinch,
  CamanJS brightness/contrast/sharpen/saturation/noise, optional second JPEG crush. Working width
  800 px; export JPEG at 0.8, or the quality slider when "after filters" is on.
- A rebuilt interface with no jQuery, analytics, ads or service worker, and an in-app licence dialog.
- A single-file portable build, or a per-user installer that needs no elevation. The app icon is
  authored rather than default, and one file feeds the executable, the window and the setup file.
- Licence: GPL-3.0-only. The upstream licence file is the GNU GPL version 3 text with no "or later"
  grant, so that is the conservative reading; the upstream credit stays intact.

## Install

The installer is per-user: it needs no administrator rights. Uninstall removes the program and leaves the
WebView2 profile folder in place, so a reinstall finds the state it had. The portable build is the same
executable with its `app\` folder beside it.

Requirements: Windows 10 or later, x64 or ARM64, and the Microsoft Edge WebView2 Runtime (present on
Windows 11). The default build is self-contained: the .NET 10 runtime travels inside the single
executable, so the machine needs no separate .NET install.

## Assets to attach

Build these from the tagged commit; do not attach a local build from an earlier tree. The setup file is
the name the build produces today; the zip name is a packaging choice for the release. Internal names that
keep the pre-rename spelling are listed in [`naming.md`](naming.md).

| Asset | Produced by | Notes |
|---|---|---|
| `Bytefry-0.1.0-setup.exe` | `pwsh -File desktop/build.ps1 -Installer` | per-user installer, architecture follows the payload |
| `Bytefry-0.1.0-portable.zip` | `pwsh -File desktop/build.ps1`, then zip `desktop\dist\portable\` | the archive must keep `app\` beside `Bytefry.exe` |

Record the SHA-256 of each attached file at upload time and paste the real values here; do not guess
them. Tag convention: `v0.1.0`.

## Corresponding source and build materials

GPL-3.0-only section 6 requires that a binary be accompanied by its Corresponding Source, conveyed either
alongside it or from a network server at the same place; section 1 defines that source as the preferred
form plus the scripts used to control compilation and installation. So this release rides on a tag: the tag
is the source, the same release page serves the tag's source archive, and no binary is uploaded without it.

| What | How it is delivered | Notes |
|---|---|---|
| Corresponding Source for `v0.1.0` | The source archive GitHub generates for that tag, offered on the same release page (`Source code (zip)` and `Source code (tar.gz)`) | Generated from the tagged commit, not from a branch. The URL does not exist until the release is published; do not write one here before then |
| Optional curated archive | `Bytefry-0.1.0-source.zip`, built from the same commit with `git archive --format=zip --prefix=Bytefry-0.1.0/ v0.1.0` | The same tree as the tag archive, with nothing added or left out beyond the `--prefix` directory. If both are offered they must come from the identical commit |
| Rebuild route | `pwsh -File desktop/build.ps1 -Installer` from the root of the extracted archive | Needs the .NET SDK 10 and Inno Setup 6; produces an equivalent setup and portable folder, not a byte-identical reproduction — see below |

The archive carries everything needed to rebuild the binaries:

- `app/` — `index.html`, `styles.css`, `app.js`, `vendor/` (CamanJS, glfx.js), `LICENSE`, `ATTRIBUTION.md`, `README.md`.
- `desktop/` — `MemeFryer.Desktop/` (host sources, `MemeFryer.Desktop.csproj`, `app.manifest`, `Assets/` with the icon and `make-icon.py`), `installer/MemeFryer.iss`, `build.ps1`, `test.ps1`, `selfcheck-report.ps1`, `run-dev.ps1`, `NOTICE.md`, `README.md`.
- `tests/` — the web-layer suite and its fixtures — plus the root `LICENSE`, `README.md`, `assets/`, `docs/` and `.github/workflows/ci.yml`.
- `third_party/camanjs/` and `third_party/glfx/` — the upstream source of both bundled libraries at the pinned commits, their licences, a `BUILD.md` recording how each artifact was produced, and a `verify.mjs` that checks the shipped bytes against them.

Both bundled libraries have their exact source in the tag, and both ship a file that upstream published rather than one built here. For CamanJS the shipped bundle is the `dist` artifact of `caman` 4.1.2 (commit `36697e0`): after normalising line endings, `verify.mjs` matches it byte for byte. For glfx.js the shipped file is the published `gh-pages` artifact up to one header line that the upstream build tool itself changed in 2022, and upstream's `build.py` pipes the sources through whatever `closure` is on `PATH`: neither the compiler nor its version is recorded upstream, so a byte-for-byte rebuild of that bundle cannot be derived from the tree and is unverified. The artifact is pinned as a file; the source is what explains it.

That has a consequence for this release: the source archive lets anyone rebuild an equivalent Bytefry, but no byte-identical output is promised — not for `glfx.js`, and not for the Windows binaries either.

Not conveyed, and not part of the Corresponding Source: the .NET 10 SDK and runtime, the
`Microsoft.Web.WebView2` package, and the WebView2 Runtime installed on the machine. They are Microsoft's
own components under their own licences; the pinned package version (`1.0.4314.35`) and the scripts that
consume them are in the archive, which is what the licence asks for.

The notices each binary must carry, and does carry: `NOTICE.md` at the root of the portable folder and in
the install directory, `app/LICENSE`, `app/ATTRIBUTION.md` and `app/vendor/NOTICE`, plus the in-app
`Licence` dialog. The installer copies the portable folder whole, so nothing is dropped on the way in.
Record at publish time, in this file: the commit SHA, the tag, the attached source archive name and its
SHA-256, and this notice list — as they actually are, not as planned.

## Checks to record before publishing

Not yet recorded for this release. Run, in this order, and record the real output:

1. `node third_party/camanjs/verify.mjs` and `node third_party/glfx/verify.mjs` — offline and
   dependency-free: they prove the shipped `app/vendor/` bytes are the pinned upstream artifacts and that
   the source beside them is the source those artifacts came from.
2. `pwsh -File desktop/test.ps1` — the window-free suite: bridge host, injected script in Node, packaging
   invariants (including the Bytefry identity), self-check report gate, and the command line's exit codes.
3. `node tests/run.mjs` — the web-layer suite, in headless Chrome with a throwaway profile and no window.
   It carries no wall-clock assertions, so a slow or busy machine cannot turn it red.
4. `pwsh -File desktop/build.ps1 -Installer` — build both packages without opening a window.

The opt-in `-Verify` self-check creates an off-screen window and is not headless. Native window and
Open/Save dialog behavior remain unverified under the headless-only constraint. Do not uninstall an
existing installation as part of verification.

`node tests/bench.mjs` is optional and not a gate: it prints where a load spends its time, and it fails
only if two scripts produce different bytes, never on a timing difference. Quote its numbers only from the
run recorded against the tagged commit, and quote none of them in the release notes.

## Known limits

- Unsigned: SmartScreen warns on a fresh download, and there is no auto-update.
- First launch of the single-file build is slower while the native WebView2 loader is extracted.
- The executable needs its `app\` folder: without it the app shows an error and exits 2.
- The bulge is WebGL. Where it is unavailable the control disables itself and the status line says so,
  rather than rendering something different.

## Credits and licence

Bytefry is a modified desktop build of **Meme Deep Fryer** by Dima and contributors
(<https://deepfriedmemes.com>, <https://github.com/efskap/deepfriedmemes.com>), which is licensed under
the GNU General Public License, version 3. The upstream licence file carries no "or later" grant, so this
release is distributed under the same terms as GPL-3.0-only; the full text ships in the app folder as
`LICENSE`, and the changes are itemised in `ATTRIBUTION.md`.
Bundled unchanged: CamanJS (BSD-3-Clause, 2010 Ryan LeFevre) and glfx.js (MIT, 2011 Evan Wallace).

## Publication checklist

- [ ] Owner approves the release text and the assets.
- [ ] Repository created: the working copy is not a git repository yet, so there is no tag, no Issues link
      and nowhere to attach an asset.
- [ ] Checks above run and recorded.
- [ ] Tag `v0.1.0` pushed, and the binaries attached together with that tag's source archive (or a curated
      source zip from the same commit) and real SHA-256 values.
- [ ] Release notes name the tag as the Corresponding Source and list the notices each binary carries:
      `NOTICE.md`, `app/LICENSE`, `app/ATTRIBUTION.md`, `app/vendor/NOTICE`, and the in-app dialog.
