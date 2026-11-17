# Bytefry 0.1.2 - release record

| | |
|---|---|
| Published | 2026-11-17, assets uploaded 04:48 UTC, as the stable release at tag `bytefry`: exactly three assets, the ones in *Published assets* |
| Release | <https://github.com/nathwn12/bytefry/releases/tag/bytefry> - named "Bytefry 0.1.2" and carrying this version's three downloads; the release tag itself still names commit `2ab8d0b` |
| Source tag | `v0.1.2` at commit `5d78f3a0a21a1bffd25096dca9b3586f768ba932`, immutable; the unversioned `bytefry` tag stays at `2ab8d0b` and did not move with this release |
| Supersedes | 0.1.1, whose three assets this release replaced; those files are no longer downloadable, and [`release-0.1.1.md`](release-0.1.1.md) keeps their digests as the record of what was attached |
| Superseded | by [`0.1.3`](release-0.1.3.md), which is prepared and not yet published; until it is, this version's assets are the stable release's |

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

GPL-3.0-only section 6 asks for the Corresponding Source beside the binary or from the same place, and the
release offers two routes to it.

- The version tag is the source of record: <https://github.com/nathwn12/bytefry/tree/v0.1.2> names
  `5d78f3a0a21a1bffd25096dca9b3586f768ba932`, the commit that produced the binaries, and it is not moved
  afterwards. The release notes' `Corresponding source` bullet points there.
- The curated `Bytefry-0.1.2-source.zip` is one of the three attached assets. It was produced from that
  same commit with `git archive --format=zip --prefix=Bytefry-0.1.2/ <commit>`, and its SHA-256 in
  *Published assets* is the digest the uploaded file has.

One asymmetry is worth naming, because the release page invites the wrong assumption. The stable release
kept its tag: `bytefry` still names `2ab8d0b`, the 0.1.1 commit, so the `Source code (zip)` and
`Source code (tar.gz)` downloads GitHub generates from a release's tag are 0.1.1's tree, not this one.
0.1.2's corresponding source is the `v0.1.2` tag and the curated zip's contents; the curated zip is the
one file on the page that carries this tree under its own name.

The binaries were built from `5d78f3a`; this record lives in a later commit that documents that build
without changing it, the way [`release-0.1.1.md`](release-0.1.1.md) was expanded after its tag. A tag
created for this version names `5d78f3a`, not the commit that carries this file.

## Published assets

These are the bytes the stable release serves. Each was downloaded back from
`https://github.com/nathwn12/bytefry/releases/download/bytefry/<asset name>` on 2026-11-17 and hashed
again; the SHA-256 below equals both the digest GitHub reports for the asset and the local file each one
was uploaded from.

| Asset | Bytes | SHA-256 |
|---|---|---|
| `Bytefry-0.1.2-setup.exe` | 44724989 | `8c672c3dfbe176b2f92b531cfa783360271b325454118224a68d2a2e29c4a198` |
| `Bytefry-0.1.2-portable-x64.zip` | 44223025 | `f9e6c29784bb04739fd4e176e09fa1a6cc1b25c0341dde1f4256beee045d8ac2` |
| `Bytefry-0.1.2-source.zip` | 375874 | `bc37edd3a3088c509aec4694d9b895a9f6e82f8fa14b1c6d0f1385cd28e8bbfe` |

Those three are the release's whole asset list. 0.1.1's installer, portable archive and source zip were
deleted from the same release when these were attached, so the 0.1.1 asset URLs that used to work no
longer resolve.

How each was produced:

| Asset | Produced by | What was checked afterwards |
|---|---|---|
| `Bytefry-0.1.2-setup.exe` | `pwsh -File desktop/build.ps1 -Installer` | Inno Setup 6 compiled it from `desktop\dist\portable`; its version info reads 0.1.2 |
| `Bytefry-0.1.2-portable-x64.zip` | archive of the contents of `desktop\dist\portable\` | 12 entries: `Bytefry.exe`, `NOTICE.md`, `BUILD-INFO.txt`, and `app\` with its 9 files |
| `Bytefry-0.1.2-source.zip` | `git archive --format=zip --prefix=Bytefry-0.1.2/ 5d78f3a0a21a1bffd25096dca9b3586f768ba932` | 172 entries under the `Bytefry-0.1.2\` prefix, including this file; re-read from the upload, still 172 |

The executable is not anonymous about its source: the build stamps the commit into it, and the portable
copy reports `ProductVersion` `0.1.2+5d78f3a0a21a1bffd25096dca9b3586f768ba932` with `FileVersion`
`0.1.2.0`. Every file the portable bundle carries under `app\` is the committed tree's file, byte for
byte; `app/LICENSE` is the CRLF checkout of a blob that `.gitattributes` stores with LF, and it is
identical to the root `LICENSE` as shipped.

`BUILD-INFO.txt` in the portable folder records the rest of the build: Release, `win-x64`,
self-contained single file, .NET SDK 10.0.403, and the WebView2 Runtime `157.0.4341.46` found on the
build machine. The archives are not byte-reproducible - that file carries a build timestamp, and the
binaries are not promised to rebuild identically - so the digests above describe these files only.

## Installed and run

The published setup was run on this machine on 2026-11-17, as the per-user installer it is. What that
leaves behind is checkable without opening a window:

| Fact | How it was read |
|---|---|
| The installer completed | `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\*` holds one product, `Bytefry`, `DisplayVersion 0.1.2`, publisher `nathwn12`, in `%LOCALAPPDATA%\Programs\Bytefry\` with its own `unins000.exe` |
| The shortcut points at the installed program | `Desktop\Bytefry.lnk` targets `%LOCALAPPDATA%\Programs\Bytefry\Bytefry.exe`, working directory the install folder |
| The installed program is the uploaded payload | the installed `Bytefry.exe`, the `Bytefry.exe` inside `Bytefry-0.1.2-portable-x64.zip` and `desktop\dist\portable\Bytefry.exe` are one file: 49694661 bytes, SHA-256 `25f63fb87b53d4575cc9b8673c6b897531ff49f1525252e3340f6c64abe4fa6d` |
| It starts and reports its build | `Start-Process Bytefry.exe --help` from the install folder exited 0 and printed `Bytefry.exe [--selfcheck <report.json>]`; the same file's version info reads `FileVersion 0.1.2.0`, `ProductVersion 0.1.2+5d78f3a0a21a1bffd25096dca9b3586f768ba932` |

That is an install receipt, not a pixel receipt. Nobody drove the window, the stage, the menu or the
native Open and Save dialogs in this record, so how the rendered image looks and how the dialogs draw
stay unverified rather than checked.

## Checks

**Before publication - 2026-11-17, on `5d78f3a0a21a1bffd25096dca9b3586f768ba932`, from a clean working
tree.** These are the build's own gates, and they are what the uploaded assets came out of:

| Check | Command | Result |
|---|---|---|
| Vendored CamanJS | `node third_party/camanjs/verify.mjs` | ok, exit 0 |
| Vendored glfx.js | `node third_party/glfx/verify.mjs` | ok, exit 0 |
| Icon | `python desktop/MemeFryer.Desktop/Assets/make-icon.py --check` | ok - a fresh render of `assets/icon.svg` reproduces the committed `.ico` and `icon.lock` agrees |
| Window-free suite | `pwsh -File desktop/test.ps1` | 64 passed, 0 failed, 0 skipped, plus the self-check report gate |
| Web layer | `node tests/run.mjs` | 87 passed, 0 failed |
| Packaging | `pwsh -File desktop/build.ps1 -Installer` | build ok; where the three assets above came from |

**After publication - 2026-11-17, read back from the release page and the installed program.** These are
receipts a reader can repeat with `gh` and `Get-FileHash`, and they are what *Published assets* and
*Installed and run* rest on:

| Check | Command | Result |
|---|---|---|
| What the release holds | `gh release view bytefry --json name,tagName,targetCommitish,assets` | one release, `Bytefry 0.1.2`, tag `bytefry`, target `2ab8d0b`, three assets, no fourth |
| Uploaded digests | `gh release download bytefry --pattern 'Bytefry-0.1.2-*'` then `Get-FileHash -Algorithm SHA256` | all three match *Published assets* and GitHub's per-asset `digest` field |
| Tags | `git ls-remote --tags origin` | `v0.1.2` at `5d78f3a0a21a1bffd25096dca9b3586f768ba932`; `bytefry` and `v0.1.1` both at `2ab8d0b0305a8421650f85e9cc8e7f6446724ed6` |
| Generated source archive | `gh api repos/nathwn12/bytefry/zipball/bytefry` | `nathwn12-bytefry-2ab8d0b0305a8421650f85e9cc8e7f6446724ed6`, 169 entries, and no `docs/release-0.1.2.md`: the archive GitHub generates for the release's tag is 0.1.1's tree, which is why *Corresponding source* points at `v0.1.2` |
| Install | the setup was run; the uninstall key read back | `Bytefry` `0.1.2`, per-user install folder, as in *Installed and run* |
| Installed bytes | `Get-FileHash` on the installed exe and on the portable zip's copy | one SHA-256, `25f63fb8...`, so the installed program is the uploaded payload |

`-Verify` was not run. It parks a real window outside every monitor - off-screen, not headless - and
nothing in this record drives the native window or the Open and Save dialogs, so those stay unverified
rather than checked. `node tests/bench.mjs` was not run either: it is optional and not a gate.

## Known limits

- Unsigned: SmartScreen warns on a fresh download, and there is no auto-update.
- The first launch of the single-file build is slower while the native WebView2 loader is extracted.
- The executable needs its `app\` folder: without it the app shows an error and exits 2.
- The bulge is WebGL; where it is unavailable the control disables itself and the status line says so.
- The automated suite is window-free. How the rendered pixels look, and how the native Open and Save
  dialogs draw, need a human look; the install receipt above says only that the installer ran, that the
  files landed and that the program starts and answers `--help`.
- The digests describe the uploaded files as served on 2026-11-17 and are not reproducible: the archives
  carry a build timestamp and the binaries are not promised to rebuild identically.
