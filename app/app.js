'use strict';
/*
 * Meme Deep Fryer — desktop workbench.
 *
 * The processing pipeline is ported from efskap/deepfriedmemes.com
 * (https://github.com/efskap/deepfriedmemes.com), Copyright (C) Dima and
 * contributors, GNU General Public License version 3 only (GPL-3.0-only: the
 * upstream grant names no later version).
 *
 * Modified 2026-11-16 for the desktop build:
 *   - jQuery, jQuery UI, rangeslider and the website shell are gone; the
 *     interface is plain DOM. The working pipeline is unchanged.
 *   - The app talks to the native host through window.fryerHost (open, save,
 *     copy) and falls back to file input / download when it is absent.
 * See ATTRIBUTION.md for the itemised list of changes.
 *
 * Pipeline, in the original order:
 *   1. optional JPEG crush before the filters
 *   2. bulge pinching (glfx) applied to the crushed pixels
 *   3. CamanJS filters (brightness, contrast, sharpen, saturation, noise)
 *   4. optional JPEG crush after the filters
 */

(function () {
    'use strict';

    var MAX_CANVAS_WIDTH = 800;      // canvas.width = Math.min(800, img.width)
    var NUB_CENTRE_OFFSET = 4;       // bulgePinch(nub.x - 4, nub.y - 4, ...)
    var DEFAULT_SAVE_QUALITY = 0.8;  // downloadCanvasB64 default
    var KEY_RENDER_DELAY = 320;      // debounce for keyboard nudge

    var ABORTED = { aborted: true };


    function byId(id) {
        return document.getElementById(id);
    }

    var el = {
        stage: byId('stage'),
        area: byId('stage-area'),
        frame: byId('frame'),
        canvas: byId('canvas'),
        nubs: byId('nubs'),
        empty: byId('stage-empty'),
        progress: byId('progress'),
        openBtn: byId('open-btn'),
        copyBtn: byId('copy-btn'),
        saveBtn: byId('dl-btn'),
        aboutBtn: byId('about-btn'),
        about: byId('about'),
        aboutClose: byId('about-close'),
        status: byId('statustext'),
        step: byId('status-step'),
        meta: byId('image-meta'),
        fileInput: byId('imageLoader'),
        unlock: byId('unlock-bulges'),
        bulgeOpts: byId('bulge_opts'),
        addNub: byId('add-nub-btn'),
        strength: byId('global-str'),
        radius: byId('global-radius'),
        jpegBefore: byId('jpeg-before'),
        jpegAfter: byId('jpeg-after'),
        jpegOpts: byId('jpeg_opts'),
        jpegTimes: byId('jpeg_times'),
        jpegQuality: byId('jpeg_quality')
    };

    var ctx = el.canvas.getContext('2d');
    var filterInputs = Array.prototype.slice.call(
        document.querySelectorAll('#Filters input[data-filter]'));
    var allRangeInputs = Array.prototype.slice.call(
        document.querySelectorAll('input[type="range"]'));

    var values = {};

    var state = {
        image: null,        // original_img: the decoded source, at natural size
        sourceUrl: null,    // original_img_url: pristine canvas-sized JPEG
        cam: null,
        nubs: [],
        loaded: false,
        loading: false,     // a file was accepted and is still being decoded
        loadToken: 0,       // bumped to abandon a load that a newer file replaced
        hasRendered: false, // the canvas holds a completed render
        previewing: false,  // dragging or nudging: the canvas holds a raw preview
        previewPending: false, // a preview was asked for while a render was running
        rendering: false,
        pending: false,
        token: 0,           // bumped to abandon an in-flight render
        sourceName: ''
    };


    function setStatus(text, kind) {
        if (el.status.textContent !== text) {
            el.status.textContent = text;
            setStep('');
        }

        if (kind) el.status.setAttribute('data-kind', kind);
        else el.status.removeAttribute('data-kind');
    }

    function setStep(text) {
        if (el.step) el.step.textContent = text;
    }

    function setBusy(busy) {
        el.progress.hidden = !busy;
        el.frame.classList.toggle('busy', busy);
        el.stage.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    function messageOf(err) {
        if (!err) return 'unknown error';
        return err.message || String(err);
    }

    function canvasIsFinal() {
        return state.loaded && state.hasRendered && !state.loading &&
            !state.rendering && !state.previewing;
    }

    function syncExportState() {
        var allowed = canvasIsFinal();
        el.saveBtn.disabled = !allowed;
        el.copyBtn.disabled = !allowed;
    }

    function requireFinalCanvas() {
        if (state.loading) {
            setStatus('Still loading that image — try again in a moment.');
            return false;
        }
        if (state.rendering) {
            setStatus('Still rendering — try again in a moment.');
            return false;
        }
        if (state.previewing) {
            setStatus('Finish the bulge point first — that is still a preview.');
            return false;
        }
        if (!state.hasRendered) {
            setStatus('Nothing to export yet.');
            return false;
        }
        return true;
    }


    function syncOutput(input) {
        var out = document.querySelector('output[for="' + input.id + '"]');
        if (out) out.textContent = input.value;

        var min = parseFloat(input.min);
        var max = parseFloat(input.max);
        var value = parseFloat(input.value);
        var pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
        input.style.setProperty('--fill', pct.toFixed(2) + '%');
    }

    function syncAllOutputs() {
        allRangeInputs.forEach(syncOutput);
    }

    function setControlsEnabled(on) {
        filterInputs.forEach(function (input) { input.disabled = !on; });
        el.jpegBefore.disabled = !on;
        el.jpegAfter.disabled = !on;
        el.jpegTimes.disabled = !on;
        el.jpegQuality.disabled = !on;
        el.unlock.disabled = !on;
    }

    function syncPanels() {
        var bulgeOn = el.unlock.checked && state.loaded;

        el.bulgeOpts.hidden = !el.unlock.checked;
        el.jpegOpts.hidden = !(el.jpegBefore.checked || el.jpegAfter.checked);
        el.nubs.hidden = !bulgeOn;
        el.strength.disabled = !bulgeOn;
        el.radius.disabled = !bulgeOn;
        el.addNub.disabled = !bulgeOn;
    }


    function hostBridge() {
        var host = window.fryerHost;
        if (!host || !host.available) return null;
        return host;
    }

    function syncHostUi() {
        el.copyBtn.hidden = !hostBridge();
    }


    var fxCanvas = null;
    var fxBroken = false;

    function getFxCanvas() {
        if (fxBroken) return null;
        if (fxCanvas) return fxCanvas;

        try {
            if (typeof fx === 'undefined' || typeof fx.canvas !== 'function') {
                throw new Error('glfx.js is not loaded');
            }
            fxCanvas = fx.canvas();
        } catch (err) {
            fxBroken = true;
            disableBulge(err);
            return null;
        }
        return fxCanvas;
    }

    function disableBulge(err) {
        el.unlock.checked = false;
        el.unlock.disabled = true;
        syncPanels();
        setStatus('Bulge needs WebGL, which is unavailable here.', 'error');
        if (window.console) console.warn('bulge disabled:', err);
    }

    function bulge() {
        if (!el.unlock.checked) return;

        var canvasFx = getFxCanvas();
        if (!canvasFx) return;

        var strength = parseFloat(el.strength.value);
        var radius = parseFloat(el.radius.value) *
            (el.canvas.width + el.canvas.height) / 2;

        var texture = null;
        try {
            texture = canvasFx.texture(el.canvas);
            var out = canvasFx.draw(texture);
            for (var i = 0; i < state.nubs.length; i++) {
                var nub = state.nubs[i];
                out = out.bulgePinch(
                    nub.x - NUB_CENTRE_OFFSET,
                    nub.y - NUB_CENTRE_OFFSET,
                    radius,
                    strength);
            }
            out.update();
            ctx.drawImage(canvasFx, 0, 0);
        } catch (err) {
            fxBroken = true;
            disableBulge(err);
        } finally {
            if (texture && typeof texture.destroy === 'function') {
                try { texture.destroy(); } catch (ignored) { /* texture already gone */ }
            }
        }
    }

    function previewBulge() {
        if (!state.loaded || !state.sourceUrl) return;

        if (state.rendering) {
            state.previewPending = true;
            return;
        }

        state.previewing = true;
        syncExportState();

        ctx.drawImage(state.image, 0, 0, el.canvas.width, el.canvas.height);
        bulge();

        if (!el.status.getAttribute('data-kind') && el.status.textContent !== 'Preview') {
            setStatus('Preview');
        }
    }


    function clamp(value, low, high) {
        return value < low ? low : (value > high ? high : value);
    }

    function placeNub(nub) {
        var width = el.canvas.clientWidth;
        var height = el.canvas.clientHeight;
        nub.el.style.left = (nub.x / el.canvas.width) * width + 'px';
        nub.el.style.top = (nub.y / el.canvas.height) * height + 'px';
    }

    function placeAllNubs() {
        state.nubs.forEach(placeNub);
    }

    function relabelNubs() {
        var total = state.nubs.length;
        state.nubs.forEach(function (nub, index) {
            nub.el.setAttribute('aria-label',
                'Bulge point ' + (index + 1) + ' of ' + total +
                '. Drag to move, arrow keys to nudge, Delete to remove.');
        });
        if (total === 0) el.nubs.setAttribute('aria-hidden', 'true');
        else el.nubs.removeAttribute('aria-hidden');
    }

    var keyRenderTimer = 0;

    function scheduleRender() {
        window.clearTimeout(keyRenderTimer);
        keyRenderTimer = window.setTimeout(requestRender, KEY_RENDER_DELAY);
    }

    function createNub(x, y) {
        var node = document.createElement('div');
        node.className = 'nub';
        node.tabIndex = 0;
        node.setAttribute('role', 'button');

        var nub = { x: x, y: y, el: node };
        var drag = null;

        node.addEventListener('pointerdown', function (event) {
            if (event.button !== 0) return;
            event.preventDefault();
            try { node.setPointerCapture(event.pointerId); } catch (ignored) { /* no capture */ }
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
            node.focus();
        });

        node.addEventListener('pointermove', function (event) {
            if (!drag || drag.id !== event.pointerId) return;

            if (!drag.moved &&
                Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) < 3) {
                return;
            }
            drag.moved = true;

            var rect = el.canvas.getBoundingClientRect();
            nub.x = clamp((event.clientX - rect.left) / rect.width, 0, 1) * el.canvas.width;
            nub.y = clamp((event.clientY - rect.top) / rect.height, 0, 1) * el.canvas.height;
            placeNub(nub);
            previewBulge();
        });

        node.addEventListener('pointerup', function (event) {
            if (!drag || drag.id !== event.pointerId) return;
            var moved = drag.moved;
            drag = null;
            if (moved) requestRender();
            else removeNub(nub);          // a plain click deletes the point
        });

        node.addEventListener('pointercancel', function () {
            if (!drag) return;
            drag = null;
            requestRender();
        });

        node.addEventListener('keydown', function (event) {
            var stepX = el.canvas.width / 100;
            var stepY = el.canvas.height / 100;

            if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                removeNub(nub);
                return;
            }
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                requestRender();
                return;
            }

            if (event.key === 'ArrowLeft') nub.x = clamp(nub.x - stepX, 0, el.canvas.width);
            else if (event.key === 'ArrowRight') nub.x = clamp(nub.x + stepX, 0, el.canvas.width);
            else if (event.key === 'ArrowUp') nub.y = clamp(nub.y - stepY, 0, el.canvas.height);
            else if (event.key === 'ArrowDown') nub.y = clamp(nub.y + stepY, 0, el.canvas.height);
            else return;

            event.preventDefault();
            placeNub(nub);
            previewBulge();
            scheduleRender();
        });

        state.nubs.push(nub);
        el.nubs.appendChild(node);
        placeNub(nub);
        relabelNubs();
        return nub;
    }

    function removeNub(nub) {
        var index = state.nubs.indexOf(nub);
        if (index < 0) return;

        state.nubs.splice(index, 1);
        nub.el.remove();
        relabelNubs();

        if (state.loaded) requestRender();

        var next = state.nubs[index] || state.nubs[index - 1];
        if (next) next.el.focus();
        else if (!el.addNub.disabled) el.addNub.focus();
        else el.canvas.focus({ preventScroll: true });
    }

    function clearNubs() {
        state.nubs.forEach(function (nub) { nub.el.remove(); });
        state.nubs = [];
        relabelNubs();
    }

    function addNubAtClient(clientX, clientY) {
        var rect = el.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;

        var x = clamp((clientX - rect.left) / rect.width, 0, 1) * el.canvas.width;
        var y = clamp((clientY - rect.top) / rect.height, 0, 1) * el.canvas.height;
        return createNub(x, y);
    }


    function loadInto(image, src) {
        return new Promise(function (resolve, reject) {
            image.onload = function () { resolve(); };
            image.onerror = function () { reject(new Error('the image could not be decoded')); };
            image.src = src;
        });
    }

    function createRenderJob() {
        state.token += 1;
        return {
            token: state.token,
            image: new Image(),
            repetitions: parseInt(el.jpegTimes.value, 10),
            left: 0,
            pass: 0,
            quality: parseFloat(el.jpegQuality.value),
            check: function () {
                if (this.token !== state.token) throw ABORTED;
            }
        };
    }

    async function renderJob(job) {
        await loadInto(job.image, state.sourceUrl);
        await jpegize(job);
    }

    async function jpegize(job) {
        job.check();

        var crushThisPass =
            (job.pass === 0 && el.jpegBefore.checked) ||
            (job.pass === 1 && el.jpegAfter.checked);

        job.left = crushThisPass ? job.repetitions : 0;

        if (job.pass > 0) {
            await loadInto(job.image, el.canvas.toDataURL('image/jpeg'));
            job.check();
        }

        await jpegizeInner(job);
    }

    async function jpegizeInner(job) {
        job.check();

        var image = job.image;
        ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, image.width, image.height);
        ctx.drawImage(image, 0, 0, image.width, 2, 0, -1, image.width, 2);
        ctx.drawImage(image, 0, image.height - 2, image.width, 1, 0, image.height - 1, image.width, 1);

        if (job.left > 0) {
            setStatus('Recompressing');
            setStep((job.repetitions - job.left) + '/' + job.repetitions);
            job.left -= 1;
            await loadInto(job.image, el.canvas.toDataURL('image/jpeg',
                Math.max(0, job.quality + Math.random() * 0.025)));
            job.check();
            return jpegizeInner(job);
        }

        if (job.pass === 0) {
            await applyFilters(job);
            job.pass += 1;
            return jpegize(job);
        }
    }

    async function applyFilters(job) {
        setStatus('Applying filters');
        bulge();
        job.check();

        var cam = state.cam;
        if (!cam) return;

        if (typeof cam.reloadCanvasData === 'function') cam.reloadCanvasData();

        filterInputs.forEach(function (input) {
            var name = input.dataset.filter;
            var amount = parseFloat(values[name]);
            if (amount !== 0) cam[name](amount);
        });

        await new Promise(function (resolve) {
            cam.render(function () { resolve(); });
        });
    }

    function requestRender() {
        if (!state.loaded || !state.sourceUrl) return;

        if (state.rendering) {
            state.pending = true;
            return;
        }

        /* The adopted image stays "loading" until its render actually starts.
         * Caman calls back asynchronously; clearing loading in adoptImage left
         * a gap where the canvas was rejected as "Nothing to export yet". */
        state.loading = false;
        state.rendering = true;
        state.previewing = false;
        state.previewPending = false;
        setBusy(true);
        setStatus('Rendering');
        syncExportState();

        var job = createRenderJob();
        var aborted = false;
        var failed = false;

        renderJob(job)
            .catch(function (err) {
                if (err === ABORTED) {
                    aborted = true;
                    return;
                }
                failed = true;
                state.hasRendered = false;
                if (window.console) console.error(err);
                setStatus('Processing failed: ' + messageOf(err), 'error');
            })
            .then(function () {
                state.rendering = false;
                setBusy(false);

                if (state.pending) {
                    state.pending = false;
                    requestRender();
                    return;
                }

                if (!aborted && !failed && job.token === state.token) {
                    state.hasRendered = true;
                    if (!el.status.getAttribute('data-kind')) setStatus('Done');
                }

                if (state.previewPending) {
                    state.previewPending = false;
                    previewBulge();
                }

                syncExportState();
            });
    }


    function layout() {
        if (!state.loaded || el.frame.hidden) return;

        var availableWidth = el.area.clientWidth;
        var availableHeight = el.area.clientHeight;
        if (!availableWidth || !availableHeight) return;

        var scale = Math.min(
            availableWidth / el.canvas.width,
            availableHeight / el.canvas.height);
        if (!isFinite(scale) || scale <= 0) scale = 1;

        el.frame.style.width = Math.round(el.canvas.width * scale) + 'px';
        el.frame.style.height = Math.round(el.canvas.height * scale) + 'px';
        placeAllNubs();
    }

    var layoutQueued = false;

    function requestLayout() {
        if (layoutQueued) return;
        layoutQueued = true;
        window.requestAnimationFrame(function () {
            layoutQueued = false;
            layout();
        });
    }

    function beginLoad() {
        state.loadToken += 1;
        state.loading = true;

        syncExportState();
        setStatus('Loading image…');

        return state.loadToken;
    }

    function loadSource(src, name) {
        var token = beginLoad();

        loadFromSrc(src, name, token).catch(function (err) {
            if (token !== state.loadToken) return;

            state.loading = false;
            syncExportState();
            setStatus('Could not load that image: ' + messageOf(err), 'error');
        });
    }

    function loadFromSrc(src, name, token) {
        var image = new Image();
        image.crossOrigin = 'anonymous';

        return new Promise(function (resolve, reject) {
            image.onload = function () { resolve(image); };
            image.onerror = function () { reject(new Error('that file is not an image this app can read')); };
            image.src = src;
        }).then(function (loaded) {
            if (token !== state.loadToken) return;

            adoptImage(loaded, name);
        });
    }

    function adoptImage(loaded, name) {
        state.hasRendered = false;
        state.token += 1;

        try {
            clearNubs();

            var ratio = loaded.width / loaded.height;
            el.canvas.width = Math.min(MAX_CANVAS_WIDTH, loaded.width);
            el.canvas.height = el.canvas.width / ratio;

            state.image = loaded;
            state.sourceName = name || '';

            el.canvas.removeAttribute('data-caman-id');
            ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
            ctx.drawImage(loaded, 0, 0, el.canvas.width, el.canvas.height);
            /* The pristine copy is a pipeline input, not an export. Encode it
             * off the displayed canvas so it cannot be mistaken for one. */
            var sourceCopy = document.createElement('canvas');
            sourceCopy.width = el.canvas.width;
            sourceCopy.height = el.canvas.height;
            sourceCopy.getContext('2d').drawImage(el.canvas, 0, 0);
            state.sourceUrl = sourceCopy.toDataURL('image/jpeg');

            state.cam = (typeof Caman === 'function')
                ? Caman(el.canvas, function () { requestRender(); })
                : null;
        } catch (err) {
            if (window.console) console.error(err);
            state.sourceUrl = null;
            state.cam = null;
            state.loading = false;
            state.previewing = false;
            state.previewPending = false;
            el.meta.textContent = describeImage(loaded, el.canvas);
            el.canvas.setAttribute('aria-label',
                'Image could not be prepared, ' + el.canvas.width + ' by ' +
                el.canvas.height + ' pixels. Open another image to try again.');
            syncExportState();
            layout();
            setStatus('Could not prepare that image: ' + messageOf(err), 'error');
            return;
        }

        state.loaded = true;
        state.previewing = false;
        state.previewPending = false;

        el.empty.hidden = true;
        el.frame.hidden = false;
        el.canvas.setAttribute('aria-label',
            'Processed image, ' + el.canvas.width + ' by ' + el.canvas.height +
            ' pixels. Add bulge points by clicking, when bulge is enabled.');
        el.meta.textContent = describeImage(loaded, el.canvas);
        el.canvas.focus({ preventScroll: true });

        setControlsEnabled(true);
        syncPanels();
        syncAllOutputs();
        syncExportState();
        layout();

        if (!state.cam) {
            setStatus('CamanJS failed to load; applying JPEG only.', 'error');
            requestRender();
        } else {
            setStatus('Rendering');
        }
    }

    function describeImage(image, canvas) {
        var parts = [];
        if (state.sourceName) parts.push(state.sourceName);
        parts.push(canvas.width + '×' + canvas.height + ' px');
        if (image && (image.naturalWidth > canvas.width || image.naturalHeight > canvas.height)) {
            parts.push('from ' + image.naturalWidth + '×' + image.naturalHeight);
        }
        return parts.join(' · ');
    }

    var lastObjectUrl = null;

    function releaseObjectUrl() {
        if (!lastObjectUrl) return;
        var url = lastObjectUrl;
        lastObjectUrl = null;
        try {
            URL.revokeObjectURL(url);
        } catch (ignored) { /* nothing left to release */ }
    }

    function loadFile(file) {
        if (!file) return;

        var looksLikeImage = /^image\//.test(file.type || '') ||
            /\.(png|jpe?g|jfif|gif|webp|bmp|avif|tiff?)$/i.test(file.name || '');
        if (!looksLikeImage) {
            setStatus('That file is not an image.', 'error');
            return;
        }

        var url = URL.createObjectURL(file);
        releaseObjectUrl();
        lastObjectUrl = url;

        loadSource(url, file.name);
    }

    function openImage() {
        var host = hostBridge();
        if (host) {
            setStatus('Choose an image…');
            host.openImage({ title: 'Open image' })
                .then(function (result) {
                    if (!result || !result.dataUrl) {
                        setStatus('Ready');
                        return null;
                    }
                    loadSource(result.dataUrl, result.name);
                    return null;
                })
                .catch(function (err) {
                    setStatus('Open failed: ' + messageOf(err), 'error');
                });
            return;
        }
        el.fileInput.click();
    }


    function exportQuality() {
        if (!el.jpegAfter.checked) return DEFAULT_SAVE_QUALITY;

        var parsed = parseFloat(el.jpegQuality.value);
        return isFinite(parsed) ? parsed : DEFAULT_SAVE_QUALITY;
    }

    function exportImage() {
        if (!state.loaded) return;
        if (!requireFinalCanvas()) return;

        var dataUrl = el.canvas.toDataURL('image/jpeg', exportQuality());
        var name = 'deepfried_' + Math.floor(Date.now()) + '.jpg';
        var host = hostBridge();

        if (host) {
            setStatus('Choose where to save…');
            host.saveImage({
                dataUrl: dataUrl,
                mime: 'image/jpeg',
                suggestedName: name,
                title: 'Save deep-fried image'
            }).then(function (result) {
                if (!result) {
                    setStatus('Save cancelled.');
                    return;
                }
                setStatus('Saved ' + shortName(result.path || name));
            }).catch(function (err) {
                setStatus('Save failed: ' + messageOf(err), 'error');
            });
            return;
        }

        var comma = dataUrl.indexOf(',');
        var binary = atob(dataUrl.slice(comma + 1));
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        var url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
        var link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
        setStatus('Exported ' + name);
    }

    function shortName(path) {
        var parts = String(path).split(/[\\/]/);
        return parts[parts.length - 1] || path;
    }

    function copyImage() {
        if (!state.loaded) return;
        if (!requireFinalCanvas()) return;

        var host = hostBridge();
        if (!host) return;

        setStatus('Copying…');
        host.copyImage({ dataUrl: el.canvas.toDataURL('image/png') })
            .then(function () {
                setStatus('Copied to the clipboard.');
            })
            .catch(function (err) {
                setStatus('Copy failed: ' + messageOf(err), 'error');
            });
    }


    function onPaste(event) {
        var items = event.clipboardData && event.clipboardData.items;
        if (!items) return;

        for (var i = 0; i < items.length; i++) {
            if (items[i].type && items[i].type.indexOf('image') !== -1) {
                var file = items[i].getAsFile();
                if (file) {
                    event.preventDefault();
                    loadFile(file);
                }
                return;
            }
        }
    }

    var dragDepth = 0;

    function dragHasFiles(event) {
        var types = event.dataTransfer && event.dataTransfer.types;
        return !!types && Array.prototype.indexOf.call(types, 'Files') >= 0;
    }

    function overStage(event) {
        var target = event.target;
        return !!target && typeof target.nodeType === 'number' && el.stage.contains(target);
    }

    function clearDropTarget() {
        dragDepth = 0;
        el.stage.classList.remove('drop-active');
    }

    function onDragEnter(event) {
        if (!dragHasFiles(event)) return;
        event.preventDefault();
        dragDepth += 1;
        el.stage.classList.add('drop-active');
    }

    function onDragOver(event) {
        if (!dragHasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }

    function onDragLeave() {
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) el.stage.classList.remove('drop-active');
    }

    function onDrop(event) {
        clearDropTarget();
        if (!event.dataTransfer || !event.dataTransfer.files.length) return;

        event.preventDefault();
        loadFile(event.dataTransfer.files[0]);
    }

    function onWindowDragEnter(event) {
        if (!dragHasFiles(event)) return;
        event.preventDefault();
    }

    function onWindowDragOver(event) {
        if (!dragHasFiles(event)) return;
        event.preventDefault();
        if (!overStage(event)) event.dataTransfer.dropEffect = 'none';
    }

    function onWindowDragLeave(event) {
        if (event.clientX > 0 && event.clientY > 0 &&
            event.clientX < window.innerWidth && event.clientY < window.innerHeight) return;
        clearDropTarget();
    }

    function onWindowDrop(event) {
        var files = event.dataTransfer && event.dataTransfer.files;
        clearDropTarget();
        if (!dragHasFiles(event) && !(files && files.length)) return;

        event.preventDefault();

        if (overStage(event)) return;

        if (!state.rendering && !state.previewing) {
            setStatus('Drop an image on the stage.');
        }
    }

    function onKeyDown(event) {
        var modifier = event.ctrlKey || event.metaKey;

        if (modifier && (event.key === 's' || event.key === 'S')) {
            event.preventDefault();
            exportImage();
        } else if (modifier && (event.key === 'o' || event.key === 'O')) {
            event.preventDefault();
            openImage();
        }
    }

    function bind() {
        el.openBtn.addEventListener('click', openImage);
        el.saveBtn.addEventListener('click', exportImage);
        el.copyBtn.addEventListener('click', copyImage);

        el.fileInput.addEventListener('change', function (event) {
            var files = event.target.files;
            if (files && files.length) loadFile(files[0]);
            event.target.value = '';
        });

        filterInputs.forEach(function (input) {
            input.addEventListener('input', function () {
                values[input.dataset.filter] = input.value;
                syncOutput(input);
            });
            input.addEventListener('change', function () {
                values[input.dataset.filter] = input.value;
                syncOutput(input);
                requestRender();
            });
        });

        [el.jpegTimes, el.jpegQuality].forEach(function (input) {
            input.addEventListener('input', function () { syncOutput(input); });
            input.addEventListener('change', function () {
                syncOutput(input);
                requestRender();
            });
        });

        [el.jpegBefore, el.jpegAfter].forEach(function (box) {
            box.addEventListener('change', function () {
                syncPanels();
                requestRender();
            });
        });

        el.unlock.addEventListener('change', function () {
            syncPanels();
            requestRender();
        });

        [el.strength, el.radius].forEach(function (input) {
            input.addEventListener('input', function () { syncOutput(input); });
            input.addEventListener('change', function () {
                syncOutput(input);
                requestRender();
            });
        });

        el.addNub.addEventListener('click', function () {
            if (!state.loaded || !el.unlock.checked) return;
            createNub(el.canvas.width / 2, el.canvas.height / 2);
            if (!el.nubs.hidden) {
                var last = state.nubs[state.nubs.length - 1];
                if (last) last.el.focus();
            }
            requestRender();
        });

        el.canvas.addEventListener('click', function (event) {
            if (!state.loaded || !el.unlock.checked) return;
            if (addNubAtClient(event.clientX, event.clientY)) requestRender();
        });

        window.addEventListener('paste', onPaste);
        el.stage.addEventListener('dragenter', onDragEnter);
        el.stage.addEventListener('dragover', onDragOver);
        el.stage.addEventListener('dragleave', onDragLeave);
        el.stage.addEventListener('drop', onDrop);
        window.addEventListener('dragenter', onWindowDragEnter);
        window.addEventListener('dragover', onWindowDragOver);
        window.addEventListener('dragleave', onWindowDragLeave);
        window.addEventListener('drop', onWindowDrop);
        window.addEventListener('keydown', onKeyDown);

        window.addEventListener('resize', requestLayout);
        if (window.ResizeObserver) {
            new ResizeObserver(requestLayout).observe(el.area);
        }

        el.aboutBtn.addEventListener('click', function () {
            if (typeof el.about.showModal === 'function') el.about.showModal();
            else el.about.setAttribute('open', '');
        });
        el.aboutClose.addEventListener('click', function () {
            if (typeof el.about.close === 'function') el.about.close();
            else el.about.removeAttribute('open');
        });

        window.addEventListener('fryerhostready', syncHostUi);
    }

    function init() {
        if (!ctx) {
            setStatus('This build needs a browser with canvas support.', 'error');
            return;
        }

        filterInputs.forEach(function (input) {
            values[input.dataset.filter] = input.value;
        });

        syncAllOutputs();
        syncPanels();
        syncHostUi();
        syncExportState();
        bind();
    }

    init();
})();
