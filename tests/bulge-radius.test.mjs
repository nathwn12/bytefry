/*
 * The bulge radius is a property of the image, not of the window.
 *
 * A bulge point is positioned in canvas pixels (`nub.x` is 0..canvas.width), and
 * glfx pinches the texture the canvas is, so the radius handed to `bulgePinch`
 * is in the same pixels. Deriving it from the canvas's displayed size instead
 * mixes the two coordinate systems: the same image, the same point and the same
 * radius slider then pinch different amounts of the picture, and a window that
 * is resized (or a stage laid out smaller) changes the rendered result while
 * every control stays where it was.
 *
 * The check is an equality: one image, one point, one slider, two display sizes,
 * identical pixels. A picture that did not change is only evidence if the bulge
 * changed it at all, so the bulge-off render is recorded as the anchor.
 *
 * No wall-clock assertion: renders are observed through the status line's own
 * transitions, counted by a MutationObserver installed in the page.
 */
import { PROBE } from './lib/probe.mjs';

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

const PIXEL_DIGEST = `(() => {
    const canvas = document.getElementById('canvas');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0x811c9dc5;
    for (let i = 0; i < pixels.length; i++) {
        hash ^= pixels[i];
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16);
})()`;

const DISPLAY = `(() => {
    const canvas = document.getElementById('canvas');
    const frame = document.getElementById('frame');
    return JSON.stringify({
        width: canvas.width,
        height: canvas.height,
        display: [canvas.offsetWidth, canvas.offsetHeight],
        frame: [frame.offsetWidth, frame.offsetHeight],
        nubs: document.querySelectorAll('.nub').length
    });
})()`;

async function openInApp(browser, base) {
    const page = await browser.openPage(`${base}/current/index.html`);
    await page.waitFor('document.readyState === "complete"');
    await page.evaluate(PROBE);
    try {
        await page.send('Page.setDownloadBehavior', { behavior: 'deny' });
    } catch (error) {
        /* nothing downloads here */
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

/** Runs one action that starts a render and waits for that render to finish. */
async function nextRender(page, action) {
    const before = await page.evaluate('window.__watch.cycles');
    await page.evaluate(action);
    await page.waitFor(`window.__watch.cycles > ${before}`, 120000);
}

export const name = 'bulge-radius';

export async function run({ browser, base, fixtures }) {
    const checks = [];
    const small = fixtures[0];
    const page = await openInApp(browser, base);

    await page.evaluate(RENDER_WATCH);
    await page.evaluate(`window.__t.beginLoad(${JSON.stringify(small.name)})`);
    await realDrag(page, await stagePoint(page), small.path);
    await page.evaluate('window.__t.ready(120000)');
    await page.waitFor('document.getElementById("statustext").textContent === "Done"', 120000);

    const noBulge = await page.evaluate(PIXEL_DIGEST);

    /* Bulge on, one point at the centre, the shipped strength and radius. */
    const loaded = await page.evaluateJson(`(() => {
        const unlock = document.getElementById('unlock-bulges');
        unlock.checked = true;
        unlock.dispatchEvent(new Event('change', { bubbles: true }));
        return JSON.stringify({ radius: document.getElementById('global-radius').value,
                                strength: document.getElementById('global-str').value });
    })()`);

    await nextRender(page, `(() => {
        document.getElementById('add-nub-btn').click();
        return true;
    })()`);

    const atLoadSize = {
        display: await page.evaluateJson(DISPLAY),
        digest: await page.evaluate(PIXEL_DIGEST)
    };

    checks.push({
        name: 'the bulge changes the picture, so an unchanged one would mean something',
        ok: atLoadSize.digest !== noBulge,
        detail: `without bulge ${noBulge}, with bulge ${atLoadSize.digest}`
    });
    checks.push({
        name: 'the point was placed and the render finished',
        ok: atLoadSize.display.nubs === 1,
        detail: JSON.stringify(atLoadSize.display)
    });

    /* The same render, with the stage laid out at half the width it had. The
     * stage area is what the app sizes the canvas from, so this is the window
     * being smaller as far as the app is concerned: same image, same point,
     * same strength, same radius slider value. Dispatching the slider's own
     * change event, at its unchanged value, is how a re-render is asked for
     * without any input changing. */
    const beforeShrink = await page.evaluateJson(DISPLAY);
    await page.evaluate(`(() => {
        const area = document.getElementById('stage-area');
        area.style.width = '400px';
        area.style.height = '300px';
        return true;
    })()`);
    await page.waitFor(
        `document.getElementById('canvas').offsetWidth !== ${beforeShrink.display[0]}`,
        15000);
    const shrunk = await page.evaluateJson(DISPLAY);

    await nextRender(page, `(() => {
        const radius = document.getElementById('global-radius');
        radius.value = radius.value;
        radius.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    })()`);

    const atHalfSize = {
        display: await page.evaluateJson(DISPLAY),
        digest: await page.evaluate(PIXEL_DIGEST)
    };

    checks.push({
        name: 'the second render really was displayed at a different size',
        ok: atHalfSize.display.display[0] !== atLoadSize.display.display[0] &&
            atHalfSize.display.display[0] === shrunk.display[0],
        detail: `load ${JSON.stringify(atLoadSize.display.display)}, ` +
            `half ${JSON.stringify(atHalfSize.display.display)}`
    });
    checks.push({
        name: 'the same bulge renders the same pixels at a different display size',
        ok: atHalfSize.digest === atLoadSize.digest,
        detail: `${JSON.stringify(loaded)}: load ${atLoadSize.digest} vs half ${atHalfSize.digest}`
    });

    await page.close();
    return { checks };
}
