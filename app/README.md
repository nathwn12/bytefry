# app/ — the web layer

The interface and the image pipeline, with no build step: `index.html` loads two
vendored libraries and one script. The Windows host in `desktop/` serves this
folder from `https://meme-fryer.local/`; opening `index.html` directly in a
browser works too.

```
index.html     markup: stage, grouped controls, licence dialog
styles.css     dark slate surface, violet/cyan accents, no external assets
app.js         pipeline (ported) + interface (rewritten)
vendor/        caman.full.min.js, glfx.js — the processing, unmodified; NOTICE has both licences
LICENSE        GPL-3.0-only, copied from the original project
ATTRIBUTION.md original work, itemised changes, bundled licences
```

## Processing

Unchanged from the original, and the reason this app exists:

1. optional JPEG crush **before** the filters
2. bulge pinch (glfx, WebGL) over the crushed pixels
3. CamanJS filters — brightness, contrast, sharpen, saturation, noise
4. optional JPEG crush **after** the filters

Working width is capped at 800 px; the export is JPEG at 0.8 quality unless the
"after filters" pass is on, in which case the quality slider value is used.

Export is only available when the canvas holds a finished render: a bulge drag
shows a raw preview, and the export path refuses to read that preview.

## Offline

Nothing in this folder reaches the network: no fonts, no analytics, no service
worker, no absolute paths. The page declares `connect-src 'none'`, so a fetch or
socket from the page would fail rather than silently succeed.

## Host bridge

`desktop/` injects `window.fryerHost` before any page script runs:

```js
const { name, dataUrl } = await fryerHost.openImage({ title: 'Open image' });
await fryerHost.saveImage({ dataUrl, mime: 'image/jpeg', suggestedName: 'x.jpg' });
await fryerHost.copyImage({ dataUrl });            // PNG data URL
```

`app.js` uses it when `fryerHost.available` is true and falls back to a file
input and a download link otherwise. `saveImage` and `openImage` resolve to
`null` when the user cancels a dialog.

## Keyboard

| Keys | Action |
|---|---|
| `Ctrl+O` | open an image |
| `Ctrl+S` | save the result |
| `Ctrl+V` | paste an image from the clipboard |
| arrow keys | nudge a focused bulge point |
| `Delete` | remove a focused bulge point |
| `Enter` | re-render after a keyboard nudge |
