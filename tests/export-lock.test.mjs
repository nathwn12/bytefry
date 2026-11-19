/*
 * The export lock, at the moment a file is accepted.
 *
 * Dropping an image is asynchronous: the file has to be decoded before anything
 * is on the canvas. In that gap the canvas still holds the previous render, so
 * if the lock only engages when processing starts, Save and Ctrl+S export the
 * previous image — silently, and looking like the new one — while the new one is
 * still being decoded. This test drops a replacement and inspects the controls
 * in the same task as the drop, before any decoding can have finished.
 *
 * It also covers what the lock must not break:
 *
 *   - a file that cannot be decoded leaves the previous image and its result
 *     exactly as they were, and exportable again;
 *   - two images dropped in quick succession end on the second one, whatever
 *     order their decodes finish in;
 *   - the image that does load is byte-identical to a clean load of the same
 *     file, so the lock changes no output.
 *
 * Nothing here is time-based: every observation is a control state, a status
 * line, an encode count or a hash.
 */
import { readFileSync } from 'node:fs';
import { PROBE } from './lib/probe.mjs';

function base64(path) {
    return readFileSync(path).toString('base64');
}

async function openInApp(browser, base) {
    const page = await browser.openPage(`${base}/current/index.html`);
    await page.waitFor('document.readyState === "complete"');
    await page.evaluate(PROBE);
    try {
        await page.send('Page.setDownloadBehavior', { behavior: 'deny' });
    } catch (error) {
        /* not every build exposes it; the lock is what is under test */
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

async function waitForDone(page) {
    await page.evaluate('window.__t.ready(120000)');
    await page.waitFor('document.getElementById("statustext").textContent === "Done"', 30000);
}

/** A clean load of one fixture through the real drop path, and its hash. */
async function cleanLoad(browser, base, fixture) {
    const page = await openInApp(browser, base);
    await page.evaluate(`window.__t.beginLoad(${JSON.stringify(fixture.name)})`);
    await realDrag(page, await stagePoint(page), fixture.path);
    await waitForDone(page);
    const result = { digest: await page.evaluate('window.__t.digest()') };
    await page.close();
    return result;
}

export const name = 'export-lock';

export async function run({ browser, base, fixtures }) {
    const checks = [];
    const small = fixtures[0];
    const photo = fixtures[1];
    const smallBase64 = base64(small.path);
    const photoBase64 = base64(photo.path);
    const brokenBase64 = Buffer.from('this is not an image, whatever its name says').toString('base64');

    const page = await openInApp(browser, base);
    await page.evaluate(`window.__t.beginLoad('first')`);
    await realDrag(page, await stagePoint(page), small.path);
    await waitForDone(page);
    const goodDigest = await page.evaluate('window.__t.digest()');
    const goodMeta = await page.evaluate('document.getElementById("image-meta").textContent');


    await page.evaluate('window.__t.armEncodes()');
    const immediately = await page.evaluateJson(`(() => {
        window.__t.dropBase64(${JSON.stringify(photoBase64)}, 'photo-4032x3024.png', 'image/png');
        // Same task as the drop: no decode can have completed yet.
        return window.__t.controls();
    })()`);

    checks.push({
        name: 'Save is locked in the same task that accepts the replacement',
        ok: immediately.save === true,
        detail: `save disabled: ${immediately.save}, status "${immediately.status}"`
    });
    checks.push({
        name: 'Copy is locked in the same task that accepts the replacement',
        ok: immediately.copy === true,
        detail: `copy disabled: ${immediately.copy}`
    });
    checks.push({
        name: 'the previous image is still on screen at that moment',
        ok: immediately.meta === goodMeta,
        detail: `meta "${immediately.meta}"`
    });

    const attempted = await page.evaluateJson(`(() => {
        window.__t.pressSave();
        return JSON.stringify({ controls: JSON.parse(window.__t.controls()), encodes: window.__t.encodeList() });
    })()`);
    checks.push({
        name: 'Ctrl+S in that window encodes nothing and says why',
        ok: attempted.encodes === '[]' && /loading/i.test(attempted.controls.status),
        detail: `encodes ${attempted.encodes}, status "${attempted.controls.status}"`
    });

    await waitForDone(page);
    const replacement = await page.evaluate('window.__t.digest()');
    const replacementMeta = await page.evaluate('document.getElementById("image-meta").textContent');
    checks.push({
        name: 'the replacement then loads and becomes exportable',
        ok: await page.evaluate('document.getElementById("dl-btn").disabled === false') &&
            replacementMeta.includes(photo.name),
        detail: `meta "${replacementMeta}"`
    });


    await page.evaluate('window.__t.armEncodes()');
    const brokenImmediately = await page.evaluateJson(`(() => {
        window.__t.dropBase64(${JSON.stringify(brokenBase64)}, 'broken.png', 'image/png');
        return window.__t.controls();
    })()`);
    checks.push({
        name: 'an undecodable file locks the export as soon as it is accepted',
        ok: brokenImmediately.save === true && brokenImmediately.copy === true,
        detail: `save ${brokenImmediately.save}, copy ${brokenImmediately.copy}`
    });

    await page.waitFor('document.getElementById("statustext").getAttribute("data-kind") === "error"', 30000);
    const recovered = await page.evaluateJson(`JSON.stringify({
        controls: JSON.parse(window.__t.controls()),
        digest: window.__t.digest()
    })`);
    checks.push({
        name: 'a failed decode brings the previous result back, unchanged',
        ok: recovered.controls.save === false && recovered.controls.copy === false &&
            recovered.digest === replacement,
        detail: `save ${recovered.controls.save}, sameDigest ${recovered.digest === replacement}, status "${recovered.controls.status}"`
    });
    checks.push({
        name: 'a failed decode still names the image that is on screen',
        ok: recovered.controls.meta === replacementMeta,
        detail: `meta "${recovered.controls.meta}"`
    });
    checks.push({
        name: 'a failed decode reports the failure',
        ok: /could not load/i.test(recovered.controls.status),
        detail: `status "${recovered.controls.status}"`
    });

    const afterRecovery = await page.evaluate('window.__t.digest()');
    checks.push({
        name: 'the exportable result after recovery is still byte-identical',
        ok: afterRecovery === replacement,
        detail: `${replacement} / ${afterRecovery}`
    });


    const refused = await page.evaluateJson(`(() => {
        const file = new File([new TextEncoder().encode('plain text')], 'notes.txt', { type: 'text/plain' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        const stage = document.getElementById('stage');
        for (const type of ['dragenter', 'dragover', 'drop']) {
            stage.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
        }
        return window.__t.controls();
    })()`);
    const afterRefused = await page.evaluateJson(`JSON.stringify({
        controls: JSON.parse(window.__t.controls()),
        digest: window.__t.digest()
    })`);
    checks.push({
        name: 'a file that is not an image is refused without locking or loading',
        ok: refused.save === false && /not an image/i.test(refused.status) && afterRefused.digest === replacement,
        detail: `save ${refused.save}, status "${refused.status}", sameDigest ${afterRefused.digest === replacement}`
    });


    const emptyPage = await openInApp(browser, base);
    const firstFailure = await emptyPage.evaluateJson(`(() => {
        window.__t.dropBase64(${JSON.stringify(brokenBase64)}, 'broken.png', 'image/png');
        return window.__t.controls();
    })()`);
    await emptyPage.waitFor('document.getElementById("statustext").getAttribute("data-kind") === "error"', 30000);
    const firstFailureAfter = await emptyPage.evaluateJson(`window.__t.controls()`);
    checks.push({
        name: 'a failed first load leaves Save and Copy disabled',
        ok: firstFailure.save === true && firstFailureAfter.save === true && firstFailureAfter.copy === true &&
            firstFailureAfter.meta === '' && /could not load/i.test(firstFailureAfter.status),
        detail: JSON.stringify(firstFailureAfter)
    });
    await emptyPage.close();


    const smallClean = await cleanLoad(browser, base, small);
    for (let attempt = 1; attempt <= 2; attempt++) {
        const rapid = await page.evaluateJson(`(() => {
            window.__t.armEncodes();
            window.__t.beginLoad('rapid');
            window.__t.dropBase64(${JSON.stringify(photoBase64)}, 'photo-4032x3024.png', 'image/png');
            const lockedAfterFirst = JSON.parse(window.__t.controls());
            window.__t.dropBase64(${JSON.stringify(smallBase64)}, 'small-800x600.png', 'image/png');
            const lockedAfterSecond = JSON.parse(window.__t.controls());
            return JSON.stringify({ lockedAfterFirst, lockedAfterSecond });
        })()`);
        checks.push({
            name: `both rapid drops keep the export locked (attempt ${attempt})`,
            ok: rapid.lockedAfterFirst.save === true && rapid.lockedAfterSecond.save === true,
            detail: `first ${rapid.lockedAfterFirst.save}, second ${rapid.lockedAfterSecond.save}`
        });

        await waitForDone(page);
        await new Promise(resolve => setTimeout(resolve, 400));   // let a superseded decode land, if it is going to
        const rapidResult = await page.evaluateJson(`JSON.stringify({
            digest: window.__t.digest(),
            meta: document.getElementById('image-meta').textContent,
            save: document.getElementById('dl-btn').disabled
        })`);
        checks.push({
            name: `the last image dropped is the image that ends up on the canvas (attempt ${attempt})`,
            ok: rapidResult.meta.includes(small.name) && rapidResult.digest === smallClean.digest,
            detail: `meta "${rapidResult.meta}", matches clean load: ${rapidResult.digest === smallClean.digest}`
        });
        checks.push({
            name: `a rapid pair still ends exportable (attempt ${attempt})`,
            ok: rapidResult.save === false,
            detail: `save disabled: ${rapidResult.save}`
        });
    }

    await page.close();
    return { checks };
}
