# Bytefry 0.1.1 — release record

| | |
|---|---|
| Published | 2026-11-16, 19:35 UTC |
| Tag | `v0.1.1` at commit `2ab8d0b0305a8421650f85e9cc8e7f6446724ed6` |
| Release page | <https://github.com/nathwn12/bytefry/releases/tag/v0.1.1> |
| Superseded | no; this is the current release |

The 0.1.0 application with a redesigned icon. Deep-fry an image in a Windows window: repeat-JPEG
crush, a WebGL bulge and five filters, all running on your machine, then save. Still no analytics,
no account and no updater of its own.

## What changed since 0.1.0

- The icon is a transparent Bytefry mark drawn from one vector source, `assets/icon.svg`: the
  background is whatever the icon sits on, not a ground baked into the image. The README shows the
  same file.
- `Assets/make-icon.py` rasterises that SVG into `Assets/MemeFryer.ico` at 16, 24, 32, 48, 64, 128
  and 256 px and writes `Assets/icon.lock`, the sha256 of both files. The window-free suite compares
  the lock with the files, so the icon checks stay red without Python when either side moves alone.
- `Assets/icon-source.png`, the opaque bitmap the previous icon was traced from, is gone.

Nothing else moved: the pipeline and its order, the 800 px working cap, the export rules, the
per-user installer, the portable layout, the bridge contract v1 and the GPL-3.0-only licence are the
ones shipped in 0.1.0.

## What is in it

- A WinForms host around Microsoft Edge WebView2 that serves the bundled web app from one virtual
  origin, denies CORS and cancels every navigation, new window and permission request that would leave
  it.
- The upstream processing pipeline in its original order: optional JPEG crush, the glfx bulge pinch,
  CamanJS brightness/contrast/sharpen/saturation/noise, optional second JPEG crush. Working width
  800 px; export JPEG at 0.8, or the quality slider when "after filters" is on.
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

## Released assets

Built from the tagged commit; these are the names, bytes and digests the release page carries. The zip
name differs from 0.1.0's: that release shipped `Bytefry-0.1.0-portable-x64-release.zip`, and this one
ships `Bytefry-0.1.1-portable-x64.zip`. Internal names that keep the pre-rename spelling are listed in
[`naming.md`](naming.md).

| Asset | Bytes | SHA-256 |
|---|---|---|
| `Bytefry-0.1.1-setup.exe` | 44724689 | `0530bdac4e0c93318819883fcf6ffabb98e12f3c4d49499c1dc1875fe04e509b` |
| `Bytefry-0.1.1-portable-x64.zip` | 44222681 | `35ccaa08db3e26b55d0e4ca273e21e084133eaa0e66051062012647b5acc9933` |
| `Bytefry-0.1.1-source.zip` | 364182 | `8c05c4717e560e6e03449a6db2137f8610783883cfecce24ef71c54c3afbf279` |

How each one is produced:

| Asset | Produced by | Notes |
|---|---|---|
| `Bytefry-0.1.1-setup.exe` | `pwsh -File desktop/build.ps1 -Installer` | per-user installer, architecture follows the payload |
| `Bytefry-0.1.1-portable-x64.zip` | `pwsh -File desktop/build.ps1`, then archive the contents of `desktop\dist\portable\` | the archive keeps `app\` beside `Bytefry.exe` |
| `Bytefry-0.1.1-source.zip` | `git archive --format=zip --prefix=Bytefry-0.1.1/ v0.1.1` | the curated source archive; see below |

## Corresponding source and build materials

GPL-3.0-only section 6 requires that a binary be accompanied by its Corresponding Source, conveyed
either alongside it or from a network server at the same place; section 1 defines that source as the
preferred form plus the scripts used to control compilation and installation. So this release rides on
a tag: the tag is the source, the same release page serves the tag's source archive, and no binary is
uploaded without it.

| What | How it is delivered | Notes |
|---|---|---|
| Corresponding Source for `v0.1.1` | The source archive GitHub generates for that tag, offered on the same release page (`Source code (zip)` and `Source code (tar.gz)`) | Generated from the tagged commit, not from a branch; both are on the release page |
| Curated archive | `Bytefry-0.1.1-source.zip` on the same release page — 364182 bytes, SHA-256 in *Released assets* above | Built from the tag with `git archive --format=zip --prefix=Bytefry-0.1.1/ v0.1.1`. The same tree as the tag archive, with nothing added or left out beyond the `--prefix` directory |
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
The commit SHA, the tag, the attached source archive name and its SHA-256 are recorded in the tables
above.

## Checks

Two runs are involved, and they are not the same evidence.

**Publication day — 2026-11-16, before the release, on `2ab8d0b`.** The session that published 0.1.1
recorded `node tests/run.mjs` at 76 passed, both `third_party/*/verify.mjs` ok, `desktop/test.ps1` at 63
passed with every check window-free, and `pwsh -File desktop/build.ps1 -Installer` succeeding — which is
where the attached installer came from. The icon check is not in that record. None of the output is on
the release page or in this repository: it is the build session's record, not a receipt a reader can
check independently.

**This record — 2026-11-17, from a tree that differs from tag `v0.1.1` (tree `e3f8828`) only in
documentation.** A re-run, not the tag build:

| Check | Command | Result |
|---|---|---|
| Vendored CamanJS | `node third_party/camanjs/verify.mjs` | ok — the shipped bundle is the pinned upstream `dist` artifact after CRLF→LF, and all 67 registrations are present |
| Vendored glfx.js | `node third_party/glfx/verify.mjs` | ok — the published artifact up to the header URL, 28 attached methods backed by the vendored source |
| Icon | `python desktop/MemeFryer.Desktop/Assets/make-icon.py --check` | ok — a fresh render of `assets/icon.svg` reproduces the committed `.ico`, and `icon.lock` agrees |
| Window-free suite | `pwsh -File desktop/test.ps1` | all window-free checks passed: 63 passed, 0 failed, 0 skipped, plus the self-check report gate |
| Web layer | `node tests/run.mjs` | 76 passed, 0 failed |
| Packaging | `pwsh -File desktop/build.ps1 -Installer` | no durable receipt from this record — the re-run covered the five rows above and stopped there |
| Self-check (`-Verify`) | `pwsh -File desktop/build.ps1 -Verify` | no receipt in either run; it parks a real window outside every monitor, so it is off-screen rather than headless |

`-Verify` stays opt-in. No receipt records it running, and nothing in the re-run drives the native
window or the Open/Save dialogs, so those stay unverified rather than checked. Do not uninstall an
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
- An upgraded install reuses the previous directory and overwrites the payload, so a superseded
  `MemeFryer.exe` can be left beside `Bytefry.exe`; deleting it by hand is safe.

## Credits and licence

Bytefry is a modified desktop build of **Meme Deep Fryer** by Dima and contributors
(<https://deepfriedmemes.com>, <https://github.com/efskap/deepfriedmemes.com>), which is licensed under
the GNU General Public License, version 3. The upstream licence file carries no "or later" grant, so this
release is distributed under the same terms as GPL-3.0-only; the full text ships in the app folder as
`LICENSE`, and the changes are itemised in `ATTRIBUTION.md`.
Bundled unchanged: CamanJS (BSD-3-Clause, 2010 Ryan LeFevre) and glfx.js (MIT, 2011 Evan Wallace).

## Publication record

Receipts this repository can cite: the release pages exist and are published under the `nathwn12`
account, the tags are objects in this repository, each attached asset downloads with the digest above,
and the shipped executable reports its own version.

- [x] `0.1.1` in `MemeFryer.Desktop.csproj`, `CHANGELOG.md` and this file agree, and the executable in
      the attached portable archive reports `FileVersion 0.1.1.0` and
      `ProductVersion 0.1.1+2ab8d0b…`.
- [x] Tag `v0.1.1` pushed without moving `v0.1.0`, and the binaries attached together with that tag's
      source archives and the curated source zip; the SHA-256 values are in *Released assets*.
- [x] The 0.1.0 release stays as published: both release pages exist, and this one is a new release.
- [x] Release notes state that the corresponding source and third-party notices are included.
- [x] Five of the gate's steps were re-run for this record — both third-party verifiers,
      `make-icon.py --check`, `desktop/test.ps1` (63 passed, 0 failed) and `node tests/run.mjs`
      (76 passed, 0 failed); *Checks* gives the results and says which tree they came from.
- [ ] Owner approval of the release text and the assets: no durable receipt. The owner asked for the
      release carrying the new icon and the installer in the session that produced 0.1.1; that request
      lives in session context, not in an artifact this repository or the release page carries, so this
      record cannot cite it as proof.
- [ ] The publication-day gate, packaging included: no durable receipt. The build session recorded
      `node tests/run.mjs` at 76 passed, both verifiers ok, `desktop/test.ps1` at 63 passed and a
      successful `-Installer` build, all before the release — see *Checks*.
- [ ] `-Verify`: no receipt in either the publication-day record or the re-run, so the native window and
      the dialogs remain unverified rather than checked.
- [ ] Release notes name the tag as the Corresponding Source: missing from the 0.1.1 notes, where the
      0.1.0 notes do name it. The tag's own source archives are on the release page either way, so the
      licence condition is met; the sentence is simply absent.
