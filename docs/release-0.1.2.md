# Bytefry 0.1.2 - release record

| | |
|---|---|
| Status | prepared and built locally, not published: no `v0.1.2` tag, no release page and no uploaded asset exist yet |
| Source tag | `v0.1.2`, to be created from the commit that produced the binaries, and immutable once created |
| Release | the stable release at tag `bytefry` is left where it is, at commit `2ab8d0b`, still carrying 0.1.1's downloads; this version does not move that tag, and its assets are replaced only when 0.1.2 is actually published |
| Supersedes | 0.1.1, when this version is published; until then the stable release serves 0.1.1's assets |

Two defects in the image controls and one wrong sentence in the README, all found by a cold review. The
host, the installer, the pipeline's order and constants, the bridge contract, the portable layout and
the licence are those of 0.1.1.

## What changed since 0.1.1

- The bulge radius is measured in canvas pixels, the units the points and the effect already use. It
  was measured from the canvas's displayed size, so the same point at the same slider value rendered a
  different picture whenever the stage displayed the canvas at another size.
- A Quality slider at 0 saves at 0. The save treated the parsed value as a truthiness test, so the
  slider's lowest setting produced a 0.8 file and said nothing about it. The 0.8 default still governs
  when the after-filters pass is off.
- The README no longer says nothing is written to the registry. The installer registers the per-user
  Apps & Features entry it always did; the host process is what writes nothing.

## What is in it

Everything 0.1.1 shipped - the WinForms host around Microsoft Edge WebView2, the upstream pipeline in
its original order at an 800 px working width, the rebuilt interface, the per-user installer and the
portable layout - with the two control fixes above. [`release-0.1.1.md`](release-0.1.1.md) holds the full
inventory.

## Install

The installer keeps its `AppId`, so an existing install upgrades in place rather than appearing twice.
It needs no administrator rights, and uninstalling leaves the WebView2 profile folder where it is.
Requirements are unchanged: Windows 10 or later, x64 or ARM64, and the Microsoft Edge WebView2 Runtime.

## Corresponding source

The version tag is the source of record. `v0.1.2` will name the commit that produced the binaries and is
not moved afterwards; the curated `Bytefry-0.1.2-source.zip` is produced from that same commit with
`git archive --format=zip --prefix=Bytefry-0.1.2/ <commit>`. The unversioned `bytefry` tag stays where it
is, carrying 0.1.1's downloads, until this version is published and its assets replace them there.

The binaries were built from `5d78f3a`; this record lives in a later commit that documents that build
without changing it, the way [`release-0.1.1.md`](release-0.1.1.md) was expanded after its tag. A tag
created for this version names `5d78f3a`, not the commit that carries this file.

## Built here, not published

These files were built on the machine that wrote this record on 2026-11-17 at 04:18 UTC, from commit
`5d78f3a0a21a1bffd25096dca9b3586f768ba932` ("release: prepare Bytefry 0.1.2"), which is the commit
`v0.1.2` will name. Nothing here has been uploaded to a release page, and the `bytefry` tag has not
moved. They are the bytes a publication would carry, not a publication.

| Asset | Bytes | SHA-256 |
|---|---|---|
| `Bytefry-0.1.2-setup.exe` | 44724989 | `8c672c3dfbe176b2f92b531cfa783360271b325454118224a68d2a2e29c4a198` |
| `Bytefry-0.1.2-portable-x64.zip` | 44223025 | `f9e6c29784bb04739fd4e176e09fa1a6cc1b25c0341dde1f4256beee045d8ac2` |
| `Bytefry-0.1.2-source.zip` | 375874 | `bc37edd3a3088c509aec4694d9b895a9f6e82f8fa14b1c6d0f1385cd28e8bbfe` |

How each was produced:

| Asset | Produced by | What was checked afterwards |
|---|---|---|
| `Bytefry-0.1.2-setup.exe` | `pwsh -File desktop/build.ps1 -Installer` | Inno Setup 6 compiled it from `desktop\dist\portable`; its version info reads 0.1.2 |
| `Bytefry-0.1.2-portable-x64.zip` | archive of the contents of `desktop\dist\portable\` | 12 entries: `Bytefry.exe`, `NOTICE.md`, `BUILD-INFO.txt`, and `app\` with its 9 files |
| `Bytefry-0.1.2-source.zip` | `git archive --format=zip --prefix=Bytefry-0.1.2/ 5d78f3a0a21a1bffd25096dca9b3586f768ba932` | 172 entries under the `Bytefry-0.1.2\` prefix, including this file |

The executable is not anonymous about its source: the build stamps the commit into it, and the portable
copy reports `ProductVersion` `0.1.2+5d78f3a0a21a1bffd25096dca9b3586f768ba932` with `FileVersion`
`0.1.2.0`. Every file the portable bundle carries under `app\` is the committed tree's file, byte for
byte; `app\LICENSE` is the CRLF checkout of a blob that `.gitattributes` stores with LF, and it is
identical to the root `LICENSE` as shipped.

`BUILD-INFO.txt` in the portable folder records the rest of the build: Release, `win-x64`,
self-contained single file, .NET SDK 10.0.403, and the WebView2 Runtime `157.0.4341.46` found on the
build machine. The archives are not byte-reproducible - that file carries a build timestamp, and the
binaries are not promised to rebuild identically - so the digests above describe these files only.

## Checks

Run on `5d78f3a0a21a1bffd25096dca9b3586f768ba932`, after the build, from a clean working tree:

| Check | Command | Result |
|---|---|---|
| Vendored CamanJS | `node third_party/camanjs/verify.mjs` | ok, exit 0 |
| Vendored glfx.js | `node third_party/glfx/verify.mjs` | ok, exit 0 |
| Icon | `python desktop/MemeFryer.Desktop/Assets/make-icon.py --check` | ok - a fresh render of `assets/icon.svg` reproduces the committed `.ico` and `icon.lock` agrees |
| Window-free suite | `pwsh -File desktop/test.ps1` | 64 passed, 0 failed, 0 skipped, plus the self-check report gate |
| Web layer | `node tests/run.mjs` | 87 passed, 0 failed |
| Packaging | `pwsh -File desktop/build.ps1 -Installer` | build ok; where the three assets above came from |

`-Verify` was not run. It parks a real window outside every monitor - off-screen, not headless - and
nothing in this record drives the native window or the Open and Save dialogs, so those stay unverified
rather than checked. `node tests/bench.mjs` was not run either: it is optional and not a gate.

## Known limits

- Unsigned: SmartScreen warns on a fresh download, and there is no auto-update.
- The first launch of the single-file build is slower while the native WebView2 loader is extracted.
- The executable needs its `app\` folder: without it the app shows an error and exits 2.
- The bulge is WebGL; where it is unavailable the control disables itself and the status line says so.
- The automated suite is window-free. How the rendered pixels look, and how the native Open and Save
  dialogs draw, need a human look.
- The digests and check results above belong to the local build described here. They are not yet a
  receipt from a release page, because there is no release page for this version.
