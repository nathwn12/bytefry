/*
 * What the save actually writes, at the quality the controls say.
 *
 * The Quality slider under JPEG runs from 0 to 0.5, so 0 is a value a user can
 * choose. A truthiness test on the parsed value treats it as "nothing chosen"
 * and saves a 0.8 file instead: the slider says 0, the file comes back at high
 * quality, and nothing reports it.
 *
 * Every claim here is about the saved payload, not about the encoder argument:
 *
 *   - the blob the browser fallback hands to its download link is read back and
 *     compared, byte for byte, with the same canvas encoded at the expected
 *     quality and at the 0.8 default;
 *   - the data URL the host branch passes to `fryerHost.saveImage` is compared
 *     the same way, so the route the desktop app uses is covered too.
 *
 * The comparisons are always against one canvas at one instant: the slider also
 * feeds the JPEG crush passes, so two saves of two different renders can differ
 * for a reason that has nothing to do with the save's quality. Each save is
 * followed immediately by the reference encodes, with no re-render between.
 *
 * The documented defaults are pinned as well, so a fix for 0 cannot quietly
 * move them: the slider's value while the after-filters pass is on, and 0.8
 * while it is off.
 *
 * No wall-clock assertion anywhere: renders are waited for on the status line,
 * and a save resolves through the app's own promise.
 */
import { PROBE } from './lib/probe.mjs';

const JPEG_PREFIX = 'data:image/jpeg;base64,/9j/';

function isJpeg(prefix) {
    return String(prefix || '').startsWith(JPEG_PREFIX);
}

/* Counts completed renders: a processing phase followed by "Done". */
const RENDER_WATCH = `(() => {
    if (window.__watch) return 'already installed';
    const status = document.getElementById('statustext');
    const phases = ['Rendering', 'Recompressing', 'Applying filters'];
    const watch = { cycles: 0, processing: false };
    new MutationObserver(() => {
        const text = status.textContent;
        if (phases.indexOf(text) >= 0) watch.processing = true;
        else if (text === 'Done' && watch.processing) { watch.processing = false; watch.cycles += 1; }
    }).observe(status, { childList: true, characterData: true, subtree: true });
    window.__watch = watch;
    return 'installed';
})()`;

/** Runs an action that starts a render, and returns when that render is done. */
async function afterRender(page, action) {
    const before = await page.evaluate('window.__watch.cycles');
    await page.evaluate(action);
    await page.waitFor(`window.__watch.cycles > ${before}`, 120000);
    await page.waitFor('document.getElementById("statustext").textContent === "Done"', 30000);
}

async function openInApp(browser, base) {
    const page = await browser.openPage(`${base}/current/index.html`);
    await page.waitFor('document.readyState === "complete"');
    await page.evaluate(PROBE);
    try {
        await page.send('Page.setDownloadBehavior', { behavior: 'deny' });
    } catch (error) {
        /* the payload is captured in the page, so the download itself does not matter */
    }
    return page;
}

async function stagePoint(page) {
    const rect = await page.evaluateJson(`(() => {
        const r = document.getElementById('stage').getBoundingClientRect();
        return JSON.stringify([r.x, r.y, r.width, r.height]);
    })()`);
    return [Math.round(rect[0] + rect[2] / 2), Math.round(rect[1] + rect[3] / 2)];
}

async function realDrag(page, [x, y], filePath) {
    const data = { items: [], files: [filePath], dragOperationsMask: 1 };
    await page.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
    await page.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
    await page.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });
}

async function loadAndWait(page, fixture) {
    await page.evaluate(`window.__t.beginLoad(${JSON.stringify(fixture.name)})`);
    await realDrag(page, await stagePoint(page), fixture.path);
    await page.evaluate('window.__t.ready(120000)');
    await page.waitFor('document.getElementById("statustext").textContent === "Done"', 60000);
}

async function setControl(page, id, value) {
    await afterRender(page, `(() => {
        const control = document.getElementById(${JSON.stringify(id)});
        control.value = ${JSON.stringify(String(value))};
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    })()`);
}

/**
 * Saves through the browser fallback, then encodes the same canvas at the given
 * qualities. Returns the saved payload beside the references it is judged by;
 * nothing re-renders in between.
 */
async function saveThroughFallback(page, qualities) {
    const saved = await page.evaluateJson(`(async () => {
        window.__t.armSave();
        window.__t.pressSave();
        const payload = await window.__t.savedPayload();
        const encodes = JSON.parse(window.__t.encodeList());
        const last = encodes.length ? encodes[encodes.length - 1] : null;
        return JSON.stringify({
            payload: JSON.parse(payload),
            qualityAsked: last ? last[1] : 'none',
            references: ${JSON.stringify(qualities)}.map(quality => window.__t.canvasEncode(quality)),
            status: document.getElementById('statustext').textContent
        });
    })()`);

    return {
        ...saved,
        references: Object.fromEntries(saved.references.map((entry, index) =>
            [String(qualities[index]), JSON.parse(entry)]))
    };
}

export const name = 'export-quality';

export async function run({ browser, base, fixtures }) {
    const checks = [];
    const small = fixtures[0];
    const page = await openInApp(browser, base);

    await page.evaluate(RENDER_WATCH);
    await loadAndWait(page, small);


    const shipped = await saveThroughFallback(page, [0.175, 0.8]);
    checks.push({
        name: 'a save at the shipped 0.175 writes that canvas encoded at 0.175',
        ok: shipped.payload.ok === true && shipped.payload.type === 'image/jpeg' &&
            shipped.qualityAsked === 0.175 &&
            shipped.payload.hash === shipped.references['0.175'].hash,
        detail: JSON.stringify({ payload: shipped.payload, asked: shipped.qualityAsked,
            at0175: shipped.references['0.175'] })
    });
    checks.push({
        name: 'that save is not the 0.8 encode of the same canvas',
        ok: shipped.payload.hash !== shipped.references['0.8'].hash,
        detail: `saved ${shipped.payload.hash}, 0.8 would be ${shipped.references['0.8'].hash}`
    });


    await setControl(page, 'jpeg_quality', 0);

    const zero = await saveThroughFallback(page, [0, 0.8]);
    checks.push({
        name: 'a quality slider at 0 writes that canvas encoded at 0, not at the 0.8 default',
        ok: zero.payload.ok === true &&
            zero.payload.hash === zero.references['0'].hash &&
            zero.payload.hash !== zero.references['0.8'].hash,
        detail: JSON.stringify({ payload: zero.payload, asked: zero.qualityAsked,
            at0: zero.references['0'], at08: zero.references['0.8'] })
    });
    checks.push({
        name: 'the saved quality-0 file is a real JPEG, smaller than the 0.8 encode of the same canvas',
        ok: zero.payload.type === 'image/jpeg' && zero.payload.blobBytes > 0 &&
            isJpeg(zero.payload.prefix) &&
            zero.payload.bytes < zero.references['0.8'].bytes,
        detail: `saved ${zero.payload.blobBytes} bytes as "${zero.payload.prefix}", ` +
            `0.8 would be ${zero.references['0.8'].bytes} chars`
    });
    checks.push({
        name: 'the save still reports itself written',
        ok: /^Exported /.test(zero.status),
        detail: `status "${zero.status}"`
    });


    const native = await page.evaluateJson(`(async () => {
        window.__nativeCalls = [];
        window.fryerHost = {
            available: true,
            version: 1,
            saveImage: function (args) {
                window.__nativeCalls.push(args);
                return Promise.resolve({ path: 'C:\\\\out\\\\deepfried.jpg' });
            }
        };
        window.__t.armSave();
        window.__t.pressSave();
        return JSON.stringify({ calls: window.__nativeCalls.length });
    })()`);
    await page.waitFor('document.getElementById("statustext").textContent === "Saved deepfried.jpg"', 30000);

    const nativePayload = await page.evaluateJson(`(() => {
        const call = window.__nativeCalls[0] || {};
        const reference = JSON.parse(window.__t.canvasEncode(0));
        const elsewhere = JSON.parse(window.__t.canvasEncode(0.8));
        return JSON.stringify({
            calls: window.__nativeCalls.length,
            mime: call.mime,
            hasName: typeof call.suggestedName === 'string' && call.suggestedName.length > 0,
            saved: JSON.parse(window.__t.fingerprint(call.dataUrl)),
            at0: reference,
            at08: elsewhere
        });
    })()`);

    checks.push({
        name: 'the native save receives the quality-0 payload of the same canvas',
        ok: native.calls === 1 && nativePayload.mime === 'image/jpeg' && nativePayload.hasName &&
            isJpeg(nativePayload.saved.prefix) &&
            nativePayload.saved.hash === nativePayload.at0.hash &&
            nativePayload.saved.hash !== nativePayload.at08.hash,
        detail: JSON.stringify(nativePayload)
    });


    await page.evaluate(`(() => { delete window.fryerHost; return true; })()`);
    await afterRender(page, `(() => {
        const after = document.getElementById('jpeg-after');
        after.checked = false;
        after.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    })()`);

    const fallback = await saveThroughFallback(page, [0.8, 0]);
    checks.push({
        name: 'with the after-filters pass off, the save writes the 0.8 encode whatever the slider says',
        ok: fallback.payload.ok === true && fallback.qualityAsked === 0.8 &&
            fallback.payload.hash === fallback.references['0.8'].hash &&
            fallback.payload.hash !== fallback.references['0'].hash,
        detail: JSON.stringify({ payload: fallback.payload, asked: fallback.qualityAsked,
            slider: 0, at08: fallback.references['0.8'] })
    });

    await page.close();
    return { checks };
}
