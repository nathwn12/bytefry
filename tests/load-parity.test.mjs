/*
 * The deterministic gate for the image load path.
 *
 * Nothing here measures wall-clock time. A busy runner must not turn any of
 * these red: every check is either an equality (the bytes, the pass count) or
 * an ordering (the picture is on the canvas before the result is exportable, a
 * drop is trusted, Save is locked while the pipeline runs). Speed is measured by
 * `tests/bench.mjs`, which is opt-in and reports rather than gates.
 *
 * The baseline script in `tests/fixtures/app-baseline.js` is the pre-change
 * file, so "the output did not change" is a comparison against the real thing
 * rather than a remembered hash.
 */
import { PROBE } from './lib/probe.mjs';

function dragData(paths) {
    return { items: [], files: paths, dragOperationsMask: 1 };
}

async function realDrag(page, [x, y], filePath) {
    const data = dragData([filePath]);
    await page.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
    await page.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
    await page.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });
}

async function stagePoint(page) {
    const rect = await page.evaluateJson(`(() => {
        const r = document.getElementById('stage').getBoundingClientRect();
        return JSON.stringify([r.x, r.y, r.width, r.height]);
    })()`);
    return [Math.round(rect[0] + rect[2] / 2), Math.round(rect[1] + rect[3] / 2)];
}

async function openInApp(browser, base, variant) {
    const page = await browser.openPage(`${base}/${variant}/index.html`);
    await page.waitFor('document.readyState === "complete"');
    await page.evaluate(PROBE);
    return page;
}

/** One load in a fresh page: real drop, wait for exportable, hash the result. */
async function loadCold(browser, base, variant, fixture) {
    const page = await openInApp(browser, base, variant);
    const point = await stagePoint(page);
    await page.evaluate(`window.__t.beginLoad(${JSON.stringify(fixture.name)})`);
    await realDrag(page, point, fixture.path);
    await page.evaluate('window.__t.ready(120000)');
    const result = {
        report: await page.evaluateJson('window.__t.report()'),
        digest: await page.evaluate('window.__t.digest()')
    };
    await page.close();
    return result;
}

export const name = 'load-parity';

export async function run({ browser, base, fixtures, baselineScript }) {
    const checks = [];

    if (!baselineScript) {
        return {
            checks: [{
                name: 'a baseline script is staged for comparison',
                ok: false,
                detail: 'tests/fixtures/app-baseline.js is missing'
            }]
        };
    }

    for (const fixture of fixtures) {
        const before = await loadCold(browser, base, 'baseline', fixture);
        const after = await loadCold(browser, base, 'current', fixture);
        const gutter = `  baseline ${before.digest} current ${after.digest}`;

        checks.push({
            name: `${fixture.name}: the loaded image is byte-identical to the baseline`,
            ok: after.digest === before.digest,
            detail: gutter
        });
        checks.push({
            name: `${fixture.name}: the pipeline still makes the same 28 JPEG passes`,
            ok: after.report.recompressPasses === 28 && before.report.recompressPasses === 28,
            detail: `baseline ${before.report.recompressPasses} / current ${after.report.recompressPasses}`
        });
        checks.push({
            name: `${fixture.name}: the image is dropped by a real input event`,
            ok: after.report.trusted === true && before.report.trusted === true,
            detail: `trusted: baseline ${before.report.trusted}, current ${after.report.trusted}`
        });
        checks.push({
            name: `${fixture.name}: the picture is on the canvas before the result is exportable`,
            ok: after.report.drawBeforeExport === true && before.report.drawBeforeExport === true,
            detail: `drawBeforeExport: baseline ${before.report.drawBeforeExport}, current ${after.report.drawBeforeExport}`
        });
        checks.push({
            name: `${fixture.name}: that picture is shown while the export is still locked`,
            ok: after.report.drawWhileLocked === true && before.report.drawWhileLocked === true,
            detail: `drawWhileLocked: baseline ${before.report.drawWhileLocked}, current ${after.report.drawWhileLocked}`
        });
        checks.push({
            name: `${fixture.name}: Save stays locked for every observed render phase`,
            ok: after.report.exportableDuringRender === 0 && before.report.exportableDuringRender === 0,
            detail: `exportable observations while rendering: baseline ${before.report.exportableDuringRender}, current ${after.report.exportableDuringRender}`
        });
        checks.push({
            name: `${fixture.name}: the render finishes on the status line`,
            ok: after.report.status === 'Done' && before.report.status === 'Done',
            detail: `baseline "${before.report.status}" / current "${after.report.status}"`
        });
    }

    /* A second image dropped while the first is still processing must leave the
     * second image's result, not a mixture and not an abandoned render. */
    const page = await openInApp(browser, base, 'current');
    const point = await stagePoint(page);
    const big = fixtures[fixtures.length - 1];
    const small = fixtures[0];

    await page.evaluate(`window.__t.beginLoad('reference')`);
    await realDrag(page, point, small.path);
    await page.evaluate('window.__t.ready(120000)');
    const reference = await page.evaluate('window.__t.digest()');

    await page.evaluate(`window.__t.beginLoad('superseded')`);
    await realDrag(page, point, big.path);
    /* Wait for that render to have started, not for a stopwatch: this is the
     * only precondition the replacement below depends on. */
    let midRender = true;
    try {
        await page.waitFor('window.__t.load && window.__t.load.renderStarted === true', 30000);
    } catch (error) {
        midRender = false;
    }
    await realDrag(page, point, small.path);
    await page.evaluate('window.__t.ready(120000)');
    await new Promise(resolve => setTimeout(resolve, 400));  // let any stale job finish
    const superseded = await page.evaluateJson(`JSON.stringify({
        digest: window.__t.digest(),
        status: document.getElementById('statustext').textContent,
        save: document.getElementById('dl-btn').disabled,
        meta: document.getElementById('image-meta').textContent
    })`);

    checks.push({
        name: 'an image dropped during a render replaces it, and the result is exactly the new image',
        ok: midRender && superseded.digest === reference && superseded.save === false &&
            superseded.status === 'Done' && superseded.meta.includes(small.name),
        detail: JSON.stringify({
            midRender,
            matchesCleanLoad: superseded.digest === reference,
            status: superseded.status,
            save: superseded.save,
            meta: superseded.meta
        })
    });

    await page.close();
    return { checks };
}
