# Bytefry 0.1.3 - release record

| | |
|---|---|
| Status | prepared in this repository, not published: no `v0.1.3` tag, no new release page text and no uploaded asset exist yet |
| Source tag | `v0.1.3`, to be created from the commit that produced the binaries, and immutable once created |
| Release | the stable release at tag `bytefry` still carries 0.1.2's assets at commit `2ab8d0b`; publishing this version does not move it |
| Supersedes | 0.1.2, when this version is published; until then the stable release serves 0.1.2's assets |

The window's title bar is Windows' own caption now, painted to match the app. Everything else - the
WinForms host around Microsoft Edge WebView2, the upstream pipeline, the rebuilt interface, the
bridge contract, the per-user installer, the portable layout and the GPL-3.0-only licence - is what
0.1.2 shipped.

## What changed since 0.1.2

- The window no longer opens with a light Windows caption above a near-black page. The host asks DWM
  for its immersive dark mode, and on Windows 11 for the caption and title colours the page's own top
  bar and text already use, so the title bar reads as part of the app rather than as a frame around
  it. Nothing is drawn: the drag region, double-click to maximise, Snap Layouts, Alt+Space and the
  system menu, the minimise and maximise buttons, the resize border and what Windows' automation
  exposes all stay Windows' own.
- The fallbacks are deliberate. A Windows 11 build gets the coloured caption; Windows 10 2004 and
  later gets a dark caption with Windows' own title colour; Windows 10 1809-1909 gets the same dark
  caption through the attribute number those builds understand; anything older is left alone. High
  contrast is left entirely to the system palette, and a caption coloured before contrast was switched
  on is handed back rather than left behind.
- The caption survives what Windows does to windows. It is asked for again on every handle creation
  and again when the system theme, accent or contrast changes, so none of those needs a restart. A
  refused DWM call, a refused readback or an unreachable `dwmapi.dll` is traced and the window keeps
  the caption Windows already drew; a caption fill that lands without its title colour is handed back
  to the system rather than left half-applied.

## What is in it

Everything 0.1.2 shipped - the WinForms host around Microsoft Edge WebView2, the upstream pipeline in
its original order at an 800 px working width, the rebuilt interface, the per-user installer and the
portable layout - with the native title bar above. [`release-0.1.2.md`](release-0.1.2.md) holds the
full inventory.

## Install

The installer keeps its `AppId`, so an existing install upgrades in place rather than appearing twice.
It needs no administrator rights, and uninstalling leaves the WebView2 profile folder where it is.
Requirements are unchanged: Windows 10 or later, x64 or ARM64, and the Microsoft Edge WebView2 Runtime.

## Corresponding source

The version tag is the source of record. `v0.1.3` will name the commit that produced the binaries and
is not moved afterwards; the curated `Bytefry-0.1.3-source.zip` is produced from that same commit with
`git archive --format=zip --prefix=Bytefry-0.1.3/ <commit>`. The unversioned `bytefry` tag stays where
it is, carrying 0.1.2's downloads, until this version is published and its assets replace them there.

## Known limits

- Unsigned: SmartScreen warns on a fresh download, and there is no auto-update.
- The first launch of the single-file build is slower while the native WebView2 loader is extracted.
- The executable needs its `app\` folder: without it the app shows an error and exits 2.
- The bulge is WebGL; where it is unavailable the control disables itself and the status line says so.
- The caption's colours are checked where a check can see them; how it looks hovered, focused,
  inactive, maximised, mirrored for a right-to-left system, under high contrast or in a remote
  session needs a human look. The same goes for the rendered image and the native Open and Save
  dialogs.
- No byte count, digest or check result is recorded in this file yet. They are added from the build
  that follows, in a commit that documents that build without changing it.
