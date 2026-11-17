# Bytefry 0.1.2 - release record

| | |
|---|---|
| Status | prepared in this repository, not published: no `v0.1.2` tag, no release page and no uploaded asset exist yet |
| Source tag | `v0.1.2`, to be created from the commit that produced the binaries, and immutable once created |
| Release | the stable release at tag `bytefry` still carries 0.1.1's assets at commit `2ab8d0b`; publishing this version does not move it |
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

## Known limits

- Unsigned: SmartScreen warns on a fresh download, and there is no auto-update.
- The first launch of the single-file build is slower while the native WebView2 loader is extracted.
- The executable needs its `app\` folder: without it the app shows an error and exits 2.
- The bulge is WebGL; where it is unavailable the control disables itself and the status line says so.
- The automated suite is window-free. How the rendered pixels look, and how the native Open and Save
  dialogs draw, need a human look.
- No byte count, digest or check result is recorded in this file yet. They are added from the build that
  follows, in a commit that documents that build without changing it.
