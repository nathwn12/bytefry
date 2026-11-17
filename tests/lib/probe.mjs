/*
 * The in-page side of the timing and parity tests.
 *
 * Installed once per page, before any image is loaded, so the baseline script
 * and the current one are measured identically:
 *
 *   - `first visible` is the first animation frame after the drop that can see
 *     the app's own canvas receive a draw, which is the moment the user first
 *     has a picture (the app draws the scaled source there before it processes).
 *     The draw is observed by wrapping `drawImage`, which only records a
 *     timestamp; nothing about the app's behaviour changes.
 *   - `exportable` is the first frame at or after Save becomes enabled.
 *   - Randomness is replaced with a constant, so the per-pass JPEG quality
 *     jitter and Caman's noise filter are reproducible and the final canvas and
 *     the exported JPEG can be compared exactly between variants.
 */
export const PROBE = `(() => {
  if (window.__t) return 'already installed';

  const statusEl = document.getElementById('statustext');
  const stepEl = document.getElementById('status-step');
  const frameEl = document.getElementById('frame');
  const canvasEl = document.getElementById('canvas');
  const saveEl = document.getElementById('dl-btn');

  /* Constant, not seeded: a sequence would make the output depend on how many
   * values were drawn, so an aborted render would shift every later image. A
   * constant keeps any one render reproducible on its own. */
  Math.random = function () { return 0.5; };

  const t = {
    timeline: [],
    longtasks: [],
    load: null,
    drops: [],
    _resolve: null,
    _looping: false
  };

  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) t.longtasks.push(Math.round(entry.duration));
  }).observe({ type: 'longtask', buffered: true });
  function note() {
    const row = [+performance.now().toFixed(1), statusEl.textContent, stepEl.textContent, saveEl.disabled];
    if (t.load && !t.load.renderStarted &&
        (row[1] === 'Rendering' || row[1] === 'Applying filters' || row[1] === 'Recompressing')) {
      t.load.renderStarted = true;
    }
    const last = t.timeline[t.timeline.length - 1];
    if (last && last[1] === row[1] && last[2] === row[2] && last[3] === row[3]) return;
    t.timeline.push(row);
  }
  new MutationObserver(note).observe(statusEl, { childList: true, characterData: true, subtree: true });
  new MutationObserver(note).observe(stepEl, { childList: true, characterData: true, subtree: true });
  new MutationObserver(note).observe(saveEl, { attributes: true, attributeFilter: ['disabled'] });

  // The first draw the app makes into its own canvas after a drop is the scaled
  // source going up on screen.
  const realDrawImage = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function () {
    if (this.canvas === canvasEl && t.load && !t.load.firstDrawAt) {
      t.load.firstDrawAt = performance.now();
      /* Ordering, not timing: was the picture on the canvas while the result
       * was still not exportable? That is the property a gate can hold. */
      t.load.drawWhileLocked = saveEl.disabled === true;
    }
    return realDrawImage.apply(this, arguments);
  };

  /* Every encode taken from the app's canvas, so a test can say "the export
   * path encoded nothing" without guessing from the screen. */
  const encodes = [];
  let failNextEncode = false;
  const realToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
    let row = null;
    if (this === canvasEl) {
      /* The row is pushed before the failure, as it always was: a test that
       * arms the encoder and sees it throw still records the attempt. The byte
       * length is filled in once the encode returns, so a test can tell a
       * recorded quality from one the encoder actually honoured. */
      row = [type || 'image/png', quality === undefined ? null : quality, 0];
      encodes.push(row);
      if (failNextEncode) {
        failNextEncode = false;
        throw new Error('the encoder failed');
      }
    }
    const url = realToDataURL.apply(this, arguments);
    if (row) row[2] = url.length;
    return url;
  };
  t.armEncodes = function () { encodes.length = 0; return true; };
  t.encodeCount = function () { return encodes.length; };
  t.encodeList = function () { return JSON.stringify(encodes); };
  t.failNextEncode = function () { failNextEncode = true; return true; };

  /* CamanJS construction is the other way an adoption can fail after the canvas
   * has already been resized and drawn. The wrapper keeps its properties. */
  let failCamanNext = false;
  if (typeof window.Caman === 'function') {
    const realCaman = window.Caman;
    const wrapper = function () {
      if (failCamanNext) {
        failCamanNext = false;
        throw new Error('CamanJS failed to initialize');
      }
      return realCaman.apply(this, arguments);
    };
    Object.assign(wrapper, realCaman);
    window.Caman = wrapper;
  }
  t.failCaman = function () { failCamanNext = true; return true; };

  /* A drop dispatched synchronously, so a test can inspect the state in the
   * same task and see what the app locked before any decoding could happen. */
  t.dropBase64 = function (base64, name, mime) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], name, { type: mime });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const stage = document.getElementById('stage');
    for (const type of ['dragenter', 'dragover', 'drop']) {
      stage.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }
    return true;
  };

  t.pressSave = function () {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    return true;
  };

  t.controls = function () {
    return JSON.stringify({
      save: document.getElementById('dl-btn').disabled,
      copy: document.getElementById('copy-btn').disabled,
      meta: document.getElementById('image-meta').textContent,
      status: statusEl.textContent,
      kind: statusEl.getAttribute('data-kind')
    });
  };

  document.getElementById('stage').addEventListener('drop', event => {
    /* Read the clock here rather than trusting event.timeStamp: an event
     * injected through DevTools does not necessarily carry a stamp on the
     * page's time origin. This listener is on the capture path, so it runs
     * before the app's own handler and within the same task. */
    t.drops.push({ at: performance.now(), stamp: event.timeStamp, trusted: event.isTrusted });
    if (t.load) t.load.dropAt = performance.now();
  }, true);

  function tick(ts) {
    const load = t.load;
    if (load) {
      if (!load.firstVisible && load.firstDrawAt && ts >= load.firstDrawAt) load.firstVisible = ts;
      if (!load.ready && load.firstVisible && !saveEl.disabled) load.ready = ts;
      if (load.ready && t._resolve) { const done = t._resolve; t._resolve = null; done(); }
    }
    requestAnimationFrame(tick);
  }
  if (!t._looping) { t._looping = true; requestAnimationFrame(tick); }

  t.beginLoad = function (label) {
    t.load = { label, dropAt: 0, firstDrawAt: 0, firstVisible: 0, ready: 0, renderStarted: false };
    t.timeline = [];
    t.drops = [];
    return true;
  };

  t.ready = function (timeoutMs) {
    if (t.load && t.load.ready) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      t._resolve = resolve;
      const deadline = performance.now() + (timeoutMs || 25000);
      (function poll() {
        if (t.load && t.load.ready) { t._resolve = null; resolve(true); return; }
        if (performance.now() > deadline) {
          t._resolve = null;
          reject(new Error('render never became exportable; status=' + statusEl.textContent));
          return;
        }
        requestAnimationFrame(poll);
      })();
    });
  };

  t.report = function () {
    const load = t.load;
    const drop = t.drops[0] || { at: 0, trusted: false };

    /* Milestones are taken at or after this load's own draw, so a status write
     * left over from the previous image cannot be mistaken for this one's. */
    function afterDraw(text) {
      for (const row of t.timeline) {
        if (row[0] >= load.firstDrawAt && row[1] === text) return row[0];
      }
      return 0;
    }
    const renderingAt = afterDraw('Rendering');
    const filtersAt = afterDraw('Applying filters');
    const doneAt = load.ready;

    return JSON.stringify({
      label: load.label,
      trusted: drop.trusted,
      dropAt: +drop.at.toFixed(1),
      eventStamp: +drop.stamp.toFixed(1),
      firstVisible: +load.firstVisible.toFixed(1),
      ready: +load.ready.toFixed(1),
      firstVisibleDelay: +(load.firstVisible - drop.at).toFixed(1),
      readyDelay: +(load.ready - drop.at).toFixed(1),
      processing: +(load.ready - load.firstVisible).toFixed(1),
      dropToDraw: +(load.firstDrawAt - drop.at).toFixed(1),
      drawWhileLocked: load.drawWhileLocked === true,
      drawBeforeExport: load.firstDrawAt > 0 && load.firstDrawAt <= load.ready,
      renderStarted: load.renderStarted === true,
      drawToRendering: renderingAt ? +(renderingAt - load.firstDrawAt).toFixed(1) : -1,
      renderingToFilters: renderingAt && filtersAt ? +(filtersAt - renderingAt).toFixed(1) : -1,
      filtersToDone: filtersAt && doneAt ? +(doneAt - filtersAt).toFixed(1) : -1,
      statuses: t.timeline.map(row => row[0] + ':' + row[1] + (row[2] ? ' ' + row[2] : '') + (row[3] ? '' : ' [exportable]')),
      recompressPasses: t.timeline.filter(row => row[1] === 'Recompressing').length,
      exportableDuringRender: t.timeline
        .filter(row => (row[1] === 'Recompressing' || row[1] === 'Applying filters') && row[3] === false).length,
      longtasks: t.longtasks.filter(duration => duration > 30),
      status: statusEl.textContent
    });
  };

  t.digest = function () {
    const context = canvasEl.getContext('2d');
    const pixels = context.getImageData(0, 0, canvasEl.width, canvasEl.height).data;
    let pixelHash = 0x811c9dc5;
    for (let i = 0; i < pixels.length; i++) {
      pixelHash ^= pixels[i];
      pixelHash = Math.imul(pixelHash, 0x01000193) >>> 0;
    }
    const quality = parseFloat(document.getElementById('jpeg_quality').value) || 0.8;
    const url = canvasEl.toDataURL('image/jpeg',
      document.getElementById('jpeg-after').checked ? quality : 0.8);
    let exportHash = 0x811c9dc5;
    for (let i = 0; i < url.length; i++) {
      exportHash ^= url.charCodeAt(i);
      exportHash = Math.imul(exportHash, 0x01000193) >>> 0;
    }
    return JSON.stringify({
      pixels: pixelHash.toString(16),
      export: exportHash.toString(16),
      exportBytes: url.length,
      size: canvasEl.width + 'x' + canvasEl.height
    });
  };

  window.__t = t;
  return 'installed';
})()`;
