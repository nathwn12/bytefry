/*
 * What quality the save actually asks the encoder for.
 *
 * The Quality slider under JPEG runs from 0 to 0.5, so 0 is a value a user can
 * choose, and the app must pass it through. A truthiness test on the parsed
 * value treats 0 as "nothing chosen" and silently exports at 0.8 instead: the
 * slider says 0, the file comes back at high quality, and nothing reports it.
 *
 * The two documented defaults are pinned here as well, so a fix for 0 cannot
 * quietly move them:
 *
 *   - the after-filters pass on: the slider's value, whatever it is;
 *   - the after-filters pass off: 0.8, and the slider does not override it.
 *
 * Every check is an equality on the recorded encoder argument, plus one size
 * comparison proving a quality of 0 reached the encoder rather than being
 * recorded and discarded. Nothing here measures wall-clock time.
 */
import { PROBE } from './lib/probe.mjs';

async function openInApp(browser, base) {
    const page = await browser.openPage(`${base}/current/index.html`);
    await page.waitFor('document.readyState === "complete"');
    await page.evaluate(PROBE);
    try {
        await page.send('Page.setDownloadBehavior', { behavior: 'deny' });
    } catch (error) {
        /* the encode is what is under test, not the download */
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

/** Saves once through the app's own export path and reports the encode it took. */
async function saveAndRecord(page) {
    return page.evaluateJson(`(() => {
        window.__t.armEncodes();
        window.__t.pressSave();
        const list = JSON.parse(window.__t.encodeList());
        const last = list.length ? list[list.length - 1] : null;
        return JSON.stringify({
            count: list.length,
            type: last ? last[0] : 'none',
            quality: last ? last[1] : 'none',
            bytes: last ? last[2] : 0,
            status: document.getElementById('statustext').textContent
        });
    })()`);
}

export const name = 'export-quality';

export async function run({ browser, base, fixtures }) {
    const checks = [];
    const small = fixtures[0];
    const page = await openInApp(browser, base);

    await loadAndWait(page, small);

    /* The documented default: with "after filters" on, the slider is the save's
     * quality. 0.175 is the shipped value of that slider. */
    const shipped = await saveAndRecord(page);
    checks.push({
        name: 'with the after-filters pass on, the save encodes at the slider value',
        ok: shipped.count === 1 && shipped.type === 'image/jpeg' && shipped.quality === 0.175,
        detail: JSON.stringify(shipped)
    });

    /* The zero case. The slider permits 0, so the save must encode at 0 and the
     * file that comes back must be the smaller one: a recorded 0 that produced
     * 0.8-sized bytes would be the same defect wearing a different hat. */
    await page.evaluateJson(`(() => {
        const quality = document.getElementById('jpeg_quality');
        quality.value = '0';
        quality.dispatchEvent(new Event('input', { bubbles: true }));
        quality.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    })()`);
    await page.waitFor('document.getElementById("statustext").textContent === "Done"', 120000);

    const zero = await saveAndRecord(page);
    checks.push({
        name: 'a quality slider at 0 exports at 0, not at the 0.8 default',
        ok: zero.count === 1 && zero.type === 'image/jpeg' && zero.quality === 0,
        detail: JSON.stringify(zero)
    });
    checks.push({
        name: 'the quality-0 export is a real JPEG, smaller than the 0.175 one',
        ok: zero.bytes > 0 && shipped.bytes > 0 && zero.bytes < shipped.bytes,
        detail: `0.175 writes ${shipped.bytes} chars, 0 writes ${zero.bytes}`
    });
    checks.push({
        name: 'the export still reports itself saved',
        ok: /^Exported /.test(zero.status),
        detail: `status "${zero.status}"`
    });

    /* With the after-filters pass off the save is 0.8 by design, and the slider
     * must not leak into it - the pre-existing behaviour this fix leaves alone. */
    await page.evaluateJson(`(() => {
        const after = document.getElementById('jpeg-after');
        after.checked = false;
        after.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    })()`);
    await page.waitFor('document.getElementById("statustext").textContent === "Done"', 120000);

    const fallback = await saveAndRecord(page);
    checks.push({
        name: 'with the after-filters pass off, the save is JPEG 0.8 whatever the slider says',
        ok: fallback.count === 1 && fallback.type === 'image/jpeg' && fallback.quality === 0.8,
        detail: JSON.stringify(fallback)
    });

    await page.close();
    return { checks };
}
