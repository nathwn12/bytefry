# Attribution and list of changes

## The original work

| | |
|---|---|
| Title | Meme Deep Fryer |
| Site | <https://deepfriedmemes.com> |
| Source | <https://github.com/efskap/deepfriedmemes.com> |
| Author | Dima (<https://dmitry.lol>) and contributors |
| Licence | GNU General Public License, version 3 (GPL-3.0-only), `LICENSE` in this folder |
| Technique credit | CamanJS filters, recursive JPEG recompression, glfx bulge — as described in the original `README.md` and `main.js` |

This folder is a **modified version** of that program, prepared for a Windows
desktop host. The tracked `LICENSE` names version 3 only, so the whole of it
applies: this build is distributed under the same licence, GPL-3.0-only, with no
broader grant of its own. The full licence text is `LICENSE`, copied verbatim
from the original repository.

## Changes — 2026-11-16, 2026-11-17

The processing pipeline is the original one, transcribed into `app.js`
(`jpegize`, `jpegize_inner`, `apply_filters`, `bulge` and the CamanJS filter
application, in the original order and with the original constants: 800 px
working width, JPEG repetitions 1–200 default 28, quality 0–0.5 step 0.025
default 0.175, bulge strength −1…1 default 0.7, radius 0…1 default 0.2,
`nub.x − 4` / `nub.y − 4` pinch centre, export quality 0.8 unless the
"after filters" JPEG pass is enabled).

Interface and shell:

1. **Rewritten interface** (`index.html`, `styles.css`, `app.js`). The original
   page used jQuery, jQuery UI draggable, jQuery Modal and a rangeslider
   polyfill; all four are removed and the nub drag/delete behaviour is
   reimplemented with pointer events. Layout is a desktop workbench: image stage
   plus a grouped control sidebar, dark slate surface, violet and cyan accents.
   Bulge points stay 14 px on screen but carry a 28 px pointer target expanded
   symmetrically around the same centre, and the status line is a live region
   that announces phase changes only — the "12/28" counter sits in a separate
   `aria-hidden` node and deleting the last point moves focus to a visible
   control instead of nowhere.
2. **Website shell removed**: community links, the "What is this?" tooltip, the
   page footer, the privacy modal, theme colouring and the "Browse (or paste)"
   mobile wording. Licence and attribution now live in an in-app dialog.
3. **Tracking, advertising and service worker removed**: the GoatCounter
   snippet, the ad placeholder and `sw.js` registration are gone, as are
   `manifest.json` and the absolute `/fonts/…`, `/images/…`, `/sw.js` and
   `manifest.json` paths. Every asset path is relative.
4. **Original fonts and images not bundled**: Spinnaker, `noise.png`,
   `logo.png` and `favicon.png` were presentation only, so the interface uses
   system fonts and CSS surfaces. Vendored code (`caman.full.min.js`,
   `glfx.js`) is bundled because it *is* the processing.

Behaviour changes, each deliberate and small:

5. **One glfx canvas is reused** for the life of the page. The original called
   `fx.canvas()` on every bulge, leaking a WebGL context per call and failing
   after roughly a dozen renders; the pinching maths and arguments are
   unchanged.
6. **Nub placement is measured from the canvas bounding box**, so a point sits
   under the cursor. The original mixed an `offsetX` (padding box) with a 5 px
   canvas border and a 12 px margin, which placed the point a few pixels off.
7. **The drag preview redraws the source scaled to the canvas.** The original
   redrew it at natural size, so dragging a nub on an image wider than 800 px
   briefly showed a top-left crop. The preview shows the same bulge, correctly
   placed; the committed result still comes from the full pipeline.
8. **Renders are serialised and coalesced.** The original restarted the
   recursive JPEG loop from every change event, so two quick changes could
   interleave on the same canvas. A render now finishes before the next one
   starts, and intermediate states are dropped instead of queued. The pipeline
   itself is unchanged.
9. **Controls are disabled rather than hidden** before an image is loaded, and
   the filter value read-outs are filled in at start-up instead of after the
   first load. Same controls, same defaults.
10. **Dead code dropped**: the `jpeg_quality` "faded" toggle compared a jQuery
    object with `0` and could never fire; `#jpeg_times` has a minimum of 1.
11. **Host integration**: `window.fryerHost` (open, save, copy) is used when the
    desktop host injects it; a plain browser falls back to the file input and a
    download link. Nothing about the processing depends on the host.

Additions (no original behaviour removed):

12. Native file dialog / file input, drag-and-drop onto the stage, and paste —
    all present in some form in the original except drop.
13. Keyboard: `Ctrl+O` open, `Ctrl+S` save, `Ctrl+V` paste, and on a focused
    bulge point arrow keys nudge by 1 % of the image, `Delete` removes it,
    `Enter` re-renders. A "Copy" button appears when the host provides
    `copyImage`.
14. Status text is plain ("Recompressing 12/28", "Applying filters", "Done")
    instead of emoji, and is announced through `role="status"`.
15. **The canvas is exportable only when it holds a completed render.** A drag
    paints a raw preview, and the original let Save run against it (and, if a
    change event fired mid-render, let a preview be re-encoded into the JPEG
    chain, since every recompression step reads the canvas). Save, Copy and
    `Ctrl+S` now refuse while a render is running or while a bulge point is
    being dragged or nudged, and a preview that arrives mid-render is painted
    only after the render has finished. Output of a completed render is
    unchanged.
16. **The output can be a transparent PNG.** With both JPEG options off, the
    pristine source is encoded as PNG instead of JPEG, the pass handoff and the
    save use PNG, and the canvas is cleared before each full-frame draw so a
    transparent source is not composited over the previous render. PNG mode also
    skips the two edge draws that smear the first and last row with their
    neighbours: that smear is a JPEG artifact, and on PNG it would move the alpha
    a border row carries. The alpha the filters were given is put back after
    them. The vendored sharpen kernel is a 3x3 convolution that never writes its
    first and last row, so when it runs, those two rows are restored from the
    pre-filter pixels: without that a transparent border row turns opaque and a
    two-row picture is erased. The filters and the bulge otherwise run as they do
    for JPEG, and the first and last row of a sharpened PNG are the pre-filter
    row. While a JPEG pass runs the PNG output is unavailable: a JPEG encode has
    no alpha channel and would flatten the image, so the control says so instead
    of saving an opaque file under a transparency label. The default JPEG
    pipeline, its constants and its output are unchanged.

## Kept deliberately

- **Bulge radius uses displayed dimensions.** The radius is
  `global-radius × (canvas offsetWidth + offsetHeight) / 2`, exactly the
  original's formula. It is not a pixel measure on the bitmap: it scales with
  the on-screen size, so the same slider value bulges the same fraction of the
  picture at any zoom. Converting it to intrinsic canvas pixels would change
  the result of every existing bulge, so it stays as it is.
- **`nub.x − 4` / `nub.y − 4`** is the original pinch-centre expression and is
  kept; points are placed exactly under the cursor (change 6), which is the
  only part that was corrected.

## Bundled third-party code

| File | Project | Licence | Notice |
|---|---|---|---|
| `vendor/caman.full.min.js` | [CamanJS](http://camanjs.com/) by Ryan LeFevre and contributors (package `caman` 4.1.2) | BSD-3-Clause, Copyright (c) 2010, Ryan LeFevre | `vendor/NOTICE` |
| `vendor/glfx.js` | [glfx.js](http://evanw.github.io/glfx.js/) by Evan Wallace, 2011 | MIT, Copyright (C) 2011 by Evan Wallace | `vendor/NOTICE` |

Both are unmodified and were taken from the original repository's `vendor/`
folder. Both licence texts are reproduced in full in `vendor/NOTICE`. The
CamanJS text is `third_party/camanjs/upstream/LICENSE` — the licence file at the
pinned v4.1.2 commit `36697e053d0b8f3b5cc58fba274b5cd65cb219c2` — embedded byte
for byte between marker lines: 1,481 bytes, first line `Copyright (c) 2010, Ryan
LeFevre`. CamanJS master's `LICENSE` was changed on 2016-06-08
(`25502b14b5afe61d8180666313511a4a6498318a`) and states a wider copyright year
range; that is a later text than the version this app ships, so the pinned
wording is the one used. The glfx.js text is the MIT licence its own file header
names. CamanJS is BSD-3-Clause, not MIT, despite what several package indexes
say, and the minified bundle ships without a header, so `vendor/NOTICE` is the
only place its notice appears. Both licences are GPL-compatible; neither library
is relicensed here. The GPL-3.0-only `LICENSE` in this folder governs this
application as a whole.
