/*
 * What the export lock owes when something fails.
 *
 * Two paths, both deterministic and neither time-based:
 *
 *   1. A render that throws. The canvas is left holding whatever the failed
 *      pipeline managed to paint, so it is not a finished render and Save must
 *      stay locked. Marking it exportable lets the user save half-processed
 *      pixels and be told it worked.
 *
 *   2. A failed replacement while another replacement is still decoding. The
 *      canvas still holds the last good render, and two accepted files must not
 *      conspire to forget that: the older file is superseded, the newer one
 *      fails, and the good result has to come back rather than stay locked for
 *      the rest of the session.
 *
 * Failure is injected where a real one can happen (the canvas encoder throws)
 * and through the app's own file path (a file whose bytes are not an image), so
 * nothing here is a mock of the behaviour under test.
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
        /* the lock is what is under test */
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
    await page.waitFor('document.getElementById("statustext").textContent === "Done"', 30000);
}

export const name = 'export-failure';

export async function run({ browser, base, fixtures }) {
    const checks = [];
    const small = fixtures[0];
    const photo = fixtures[1];
    const smallBase64 = base64(small.path);
    const photoBase64 = base64(photo.path);
    const brokenBase64 = Buffer.from('this is not an image, whatever its name says').toString('base64');
    /* ---- 1. a render that throws ---- */

    const page = await openInApp(browser, base);
    await loadAndWait(page, small);
    const goodDigest = await page.evaluate('window.__t.digest()');

    const failed = await page.evaluateJson(`(() => {
        window.__t.failNextEncode();          // the next canvas encode throws, mid-pipeline
        window.__t.armEncodes();
        const contrast = document.getElementById('f-contrast');
        contrast.value = String(Number(contrast.value) + 5);
        contrast.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    })()`);

    await page.waitFor('document.getElementById("statustext").getAttribute("data-kind") === "error"', 30000);
    const afterFailure = await page.evaluateJson(`JSON.stringify({
        controls: JSON.parse(window.__t.controls()),
        digest: window.__t.digest()
    })`);
    checks.push({
        name: 'a failed render is reported',
        ok: /processing failed/i.test(afterFailure.controls.status),
        detail: `status "${afterFailure.controls.status}"`
    });
    checks.push({
        name: 'a failed render does not mark the canvas exportable',
        ok: afterFailure.controls.save === true && afterFailure.controls.copy === true,
        detail: `save ${afterFailure.controls.save}, copy ${afterFailure.controls.copy}, status "${afterFailure.controls.status}"`
    });

    const exportAttempt = await page.evaluateJson(`(() => {
        window.__t.armEncodes();
        window.__t.pressSave();
        return JSON.stringify({ encodes: window.__t.encodeList(), controls: JSON.parse(window.__t.controls()) });
    })()`);
    checks.push({
        name: 'Ctrl+S after a failed render encodes nothing',
        ok: exportAttempt.encodes === '[]',
        detail: `encodes ${exportAttempt.encodes}, status "${exportAttempt.controls.status}"`
    });

    /* The app has to be usable afterwards: the next good render unlocks it. */
    await page.evaluateJson(`(() => {
        const contrast = document.getElementById('f-contrast');
        contrast.value = String(Number(contrast.value) + 5);
        contrast.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    })()`);
    await page.waitFor('document.getElementById("statustext").textContent === "Done"', 30000);
    const recovered = await page.evaluateJson(`JSON.stringify({
        save: document.getElementById('dl-btn').disabled,
        digest: window.__t.digest()
    })`);
    checks.push({
        name: 'the next good render becomes exportable again',
        ok: recovered.save === false,
        detail: `save disabled: ${recovered.save}`
    });
    checks.push({
        name: 'the recovered render is reproducible',
        ok: recovered.digest !== goodDigest,
        detail: 'a changed contrast must not hash as the old image'
    });

    /* ---- 2. a failed replacement while another replacement is decoding ---- */

    const target = await openInApp(browser, base);
    await loadAndWait(target, small);
    const beforeOverlap = await target.evaluate('window.__t.digest()');
    const beforeMeta = await target.evaluate('document.getElementById("image-meta").textContent');

    const overlap = await target.evaluateJson(`(() => {
        // Same task: the second file is accepted while the first is still decoding.
        window.__t.dropBase64(${JSON.stringify(photoBase64)}, 'photo-4032x3024.png', 'image/png');
        const lockedAfterFirst = JSON.parse(window.__t.controls());
        window.__t.dropBase64(${JSON.stringify(brokenBase64)}, 'broken.png', 'image/png');
        const lockedAfterSecond = JSON.parse(window.__t.controls());
        return JSON.stringify({ lockedAfterFirst, lockedAfterSecond });
    })()`);
    checks.push({
        name: 'both accepted files lock the export while they decode',
        ok: overlap.lockedAfterFirst.save === true && overlap.lockedAfterSecond.save === true,
        detail: `first ${overlap.lockedAfterFirst.save}, second ${overlap.lockedAfterSecond.save}`
    });

    await target.waitFor('document.getElementById("statustext").getAttribute("data-kind") === "error"', 30000);
    await new Promise(resolve => setTimeout(resolve, 600));   // let the superseded decode land too
    const afterOverlap = await target.evaluateJson(`JSON.stringify({
        controls: JSON.parse(window.__t.controls()),
        digest: window.__t.digest()
    })`);
    checks.push({
        name: 'the good result is exportable again after the overlapping failure',
        ok: afterOverlap.controls.save === false && afterOverlap.controls.copy === false,
        detail: `save ${afterOverlap.controls.save}, copy ${afterOverlap.controls.copy}, status "${afterOverlap.controls.status}"`
    });
    checks.push({
        name: 'that result is the image that was on the canvas all along',
        ok: afterOverlap.digest === beforeOverlap && afterOverlap.controls.meta === beforeMeta,
        detail: `sameDigest ${afterOverlap.digest === beforeOverlap}, meta "${afterOverlap.controls.meta}"`
    });
    checks.push({
        name: 'the overlapping failure is reported',
        ok: /could not load/i.test(afterOverlap.controls.status),
        detail: `status "${afterOverlap.controls.status}"`
    });

    /* And the app still takes a new image afterwards. */
    await loadAndWait(target, photo);
    checks.push({
        name: 'a good load after the failure still works',
        ok: await target.evaluate('document.getElementById("dl-btn").disabled === false') &&
            (await target.evaluate('document.getElementById("image-meta").textContent')).includes(photo.name),
        detail: await target.evaluate('document.getElementById("image-meta").textContent')
    });

    /* ---- 3. a recovered load must not leave a standing licence to unlock ---- */

    /* The sequence a reviewer named: a failed replacement restores export, then a
     * render fails and leaves half-processed pixels on the canvas, then another
     * replacement fails. Recovery belongs to the canvas that was on screen at the
     * time; it must not survive the render that spoiled it. */
    const stale = await openInApp(browser, base);
    await loadAndWait(stale, small);
    const staleDigest = await stale.evaluate('window.__t.digest()');

    const firstFailure = await stale.evaluateJson(`(() => {
        window.__t.dropBase64(${JSON.stringify(brokenBase64)}, 'broken.png', 'image/png');
        return window.__t.controls();
    })()`);
    await stale.waitFor('document.getElementById("statustext").textContent.indexOf("Could not load") === 0', 30000);
    const recoveredOnce = await stale.evaluateJson(`JSON.stringify({
        controls: JSON.parse(window.__t.controls()),
        digest: window.__t.digest()
    })`);
    checks.push({
        name: 'a failed replacement restores the export (baseline for this sequence)',
        ok: firstFailure.save === true && recoveredOnce.controls.save === false &&
            recoveredOnce.digest === staleDigest,
        detail: `locked on accept ${firstFailure.save}, unlocked after ${recoveredOnce.controls.save}, sameDigest ${recoveredOnce.digest === staleDigest}`
    });

    await stale.evaluateJson(`(() => {
        window.__t.failNextEncode();          // the render throws, leaving partial pixels
        const contrast = document.getElementById('f-contrast');
        contrast.value = String(Number(contrast.value) + 5);
        contrast.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    })()`);
    await stale.waitFor('document.getElementById("statustext").textContent.indexOf("Processing failed") === 0', 30000);
    const afterSpoiledRender = await stale.evaluateJson('window.__t.controls()');
    checks.push({
        name: 'the failed render locks the partially processed canvas',
        ok: afterSpoiledRender.save === true && afterSpoiledRender.copy === true,
        detail: `save ${afterSpoiledRender.save}, copy ${afterSpoiledRender.copy}, status "${afterSpoiledRender.status}"`
    });

    const secondFailure = await stale.evaluateJson(`(() => {
        window.__t.dropBase64(${JSON.stringify(brokenBase64)}, 'broken.png', 'image/png');
        return window.__t.controls();
    })()`);
    await stale.waitFor('document.getElementById("statustext").textContent.indexOf("Could not load") === 0', 30000);
    const afterSecondFailure = await stale.evaluateJson('window.__t.controls()');
    checks.push({
        name: 'a later failed replacement does not unlock what the failed render left behind',
        ok: secondFailure.save === true && afterSecondFailure.save === true &&
            afterSecondFailure.copy === true,
        detail: `locked on accept ${secondFailure.save}, still locked after ${afterSecondFailure.save}, ` +
            `copy ${afterSecondFailure.copy}, status "${afterSecondFailure.status}"`
    });

    const staleExport = await stale.evaluateJson(`(() => {
        window.__t.armEncodes();
        window.__t.pressSave();
        return JSON.stringify({ encodes: window.__t.encodeList(), controls: JSON.parse(window.__t.controls()) });
    })()`);
    checks.push({
        name: 'Ctrl+S in that state encodes nothing',
        ok: staleExport.encodes === '[]',
        detail: `encodes ${staleExport.encodes}, status "${staleExport.controls.status}"`
    });

    await stale.evaluateJson(`(() => {
        const contrast = document.getElementById('f-contrast');
        contrast.value = String(Number(contrast.value) + 5);
        contrast.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    })()`);
    await stale.waitFor('document.getElementById("statustext").textContent === "Done"', 30000);
    checks.push({
        name: 'a good render after all of that still becomes exportable',
        ok: await stale.evaluate('document.getElementById("dl-btn").disabled === false'),
        detail: 'the lock must not be permanent'
    });
    await stale.close();

    /* ---- 4. an adoption that fails after the canvas has been resized ---- */

    /* Adopting a decoded image resizes and redraws the canvas. The pristine JPEG
     * encode and CamanJS's construction both run after that, and either can throw.
     * When it does, the canvas holds a half-prepared image: the previous render is
     * gone, so nothing on it may be exported. */
    for (const stage of ['serialization', 'caman initialization']) {
        const adoption = await openInApp(browser, base);
        await loadAndWait(adoption, small);
        const beforeAdoption = await adoption.evaluate('window.__t.digest()');

        const armed = await adoption.evaluateJson(`(() => {
            window.__t.armEncodes();
            ${stage === 'serialization' ? 'window.__t.failNextEncode();' : 'window.__t.failCaman();'}
            window.__t.dropBase64(${JSON.stringify(photoBase64)}, 'photo-4032x3024.png', 'image/png');
            return window.__t.controls();
        })()`);
        checks.push({
            name: `a replacement is locked while its ${stage} runs`,
            ok: armed.save === true && armed.copy === true,
            detail: `save ${armed.save}, copy ${armed.copy}`
        });

        await adoption.waitFor('document.getElementById("statustext").getAttribute("data-kind") === "error"', 30000);
        const afterAdoption = await adoption.evaluateJson(`JSON.stringify({
            controls: JSON.parse(window.__t.controls()),
            digest: window.__t.digest()
        })`);
        checks.push({
            name: `a ${stage} failure does not expose the half-prepared canvas`,
            ok: afterAdoption.controls.save === true && afterAdoption.controls.copy === true,
            detail: `save ${afterAdoption.controls.save}, copy ${afterAdoption.controls.copy}, ` +
                `status "${afterAdoption.controls.status}"`
        });
        checks.push({
            name: `a ${stage} failure is reported`,
            ok: /could not (prepare|load)/i.test(afterAdoption.controls.status),
            detail: `status "${afterAdoption.controls.status}"`
        });
        checks.push({
            name: `the canvas after a ${stage} failure is not the old image pretending to be new`,
            ok: afterAdoption.digest !== beforeAdoption,
            detail: 'the previous render is gone; exporting it would be a lie'
        });

        const adoptionExport = await adoption.evaluateJson(`(() => {
            window.__t.armEncodes();
            window.__t.pressSave();
            return JSON.stringify({ encodes: window.__t.encodeList(), controls: JSON.parse(window.__t.controls()) });
        })()`);
        checks.push({
            name: `Ctrl+S after a ${stage} failure encodes nothing`,
            ok: adoptionExport.encodes === '[]',
            detail: `encodes ${adoptionExport.encodes}, status "${adoptionExport.controls.status}"`
        });

        await loadAndWait(adoption, small);
        checks.push({
            name: `a good load after a ${stage} failure still works`,
            ok: await adoption.evaluate('document.getElementById("dl-btn").disabled === false'),
            detail: 'the app must stay usable'
        });
        await adoption.close();
    }

    /* The same failure on a first load, where there is no previous image at all. */
    const firstAdoption = await openInApp(browser, base);
    await firstAdoption.evaluate('window.__t.failNextEncode()');
    const firstAdoptionControls = await firstAdoption.evaluateJson(`(() => {
        window.__t.dropBase64(${JSON.stringify(smallBase64)}, 'small-800x600.png', 'image/png');
        return window.__t.controls();
    })()`);
    await firstAdoption.waitFor('document.getElementById("statustext").getAttribute("data-kind") === "error"', 30000);
    const firstAdoptionAfter = await firstAdoption.evaluateJson(`window.__t.controls()`);
    checks.push({
        name: 'a failed first adoption leaves nothing exportable',
        ok: firstAdoptionControls.save === true && firstAdoptionAfter.save === true &&
            firstAdoptionAfter.copy === true,
        detail: `locked on accept ${firstAdoptionControls.save}, after ${firstAdoptionAfter.save}, ` +
            `copy ${firstAdoptionAfter.copy}, status "${firstAdoptionAfter.status}"`
    });
    await firstAdoption.close();

    await page.close();
    await target.close();
    return { checks };
}
