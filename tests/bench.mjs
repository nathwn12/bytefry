#!/usr/bin/env node
/*
 * Opt-in measurement of the image load path. Not a gate.
 *
 *   node tests/bench.mjs               # 5 cold loads per fixture per script
 *   node tests/bench.mjs --runs 9      # more samples, slower
 *
 * Each load runs in a fresh page, because a dropped file is a cold decode:
 * re-loading the same image in one page lets the image cache answer a repeated
 * data URL, which is not what a user's drop does.
 *
 * It measures the baseline script and the current one and prints where the time
 * goes: drop -> the scaled source drawn on the canvas, that draw -> the render
 * starting, the filters, and the 28 JPEG passes. The numbers are properties of
 * this machine under whatever else it is doing, so this command never fails on a
 * timing difference. It exits non-zero only if the two scripts produce different
 * bytes, which is a correctness problem and is already gated by
 * `tests/load-parity.test.mjs`.
 *
 * Read it as: which part of a load is expensive, and did the change move it.
 */
import { createHarness } from './lib/harness.mjs';
import { PROBE } from './lib/probe.mjs';

const runsArgument = process.argv.indexOf('--runs');
const RUNS = runsArgument > 0 ? Math.max(1, Number(process.argv[runsArgument + 1]) || 5) : 5;

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function fixed(value, digits = 1) {
    return Number.isFinite(value) ? value.toFixed(digits) : '-';
}

async function realDrag(page, [x, y], filePath) {
    const data = { items: [], files: [filePath], dragOperationsMask: 1 };
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

async function measure(browser, base, variant, fixture) {
    const samples = [];
    const digests = [];

    for (let i = 0; i < RUNS; i++) {
        const page = await browser.openPage(`${base}/${variant}/index.html`);
        await page.waitFor('document.readyState === "complete"');
        await page.evaluate(PROBE);
        const point = await stagePoint(page);
        await page.evaluate(`window.__t.beginLoad(${JSON.stringify(fixture.name)})`);
        await realDrag(page, point, fixture.path);
        await page.evaluate('window.__t.ready(180000)');
        samples.push(await page.evaluateJson('window.__t.report()'));
        digests.push(await page.evaluate('window.__t.digest()'));
        await page.close();
    }

    return {
        firstVisible: median(samples.map(sample => sample.firstVisibleDelay)),
        exportable: median(samples.map(sample => sample.readyDelay)),
        dropToDraw: median(samples.map(sample => sample.dropToDraw)),
        drawToRendering: median(samples.map(sample => sample.drawToRendering)),
        renderingToFilters: median(samples.map(sample => sample.renderingToFilters)),
        filtersToDone: median(samples.map(sample => sample.filtersToDone)),
        digest: digests[0],
        digestStable: new Set(digests).size === 1
    };
}

const harness = await createHarness();
const { browser, base, fixtures } = harness;

process.stdout.write(`\nImage load benchmark, ${RUNS} cold loads per fixture per script\n`);
process.stdout.write('Times are milliseconds from the drop. Machine-dependent: do not gate on them.\n');

const rows = [];
let parityBroken = false;

for (const fixture of fixtures) {
    const before = await measure(browser, base, 'baseline', fixture);
    const after = await measure(browser, base, 'current', fixture);
    if (!after.digestStable || after.digest !== before.digest) parityBroken = true;

    process.stdout.write(`\n${fixture.name}  ${Math.round((fixture.size || 0) / 1024)} KB  ` +
        `(${fixture.width}x${fixture.height})\n`);
    process.stdout.write('  stage                               baseline     current      change\n');
    const stage = (label, a, b, lowerIsBetter = true) => {
        const delta = b - a;
        const verdict = Math.abs(delta) < 1 ? 'same' : (delta < 0 ? 'faster' : 'slower');
        process.stdout.write(`  ${label.padEnd(34)} ${fixed(a).padStart(8)} ${fixed(b).padStart(11)} ` +
            `${(delta >= 0 ? '+' : '') + fixed(delta)} ${lowerIsBetter ? verdict : ''}\n`);
    };
    stage('image on screen', before.firstVisible, after.firstVisible);
    stage('exportable', before.exportable, after.exportable);
    stage('  drop -> source drawn', before.dropToDraw, after.dropToDraw);
    stage('  drawn -> render starts', before.drawToRendering, after.drawToRendering);
    stage('  render -> filters done', before.renderingToFilters, after.renderingToFilters);
    stage('  filters -> exportable', before.filtersToDone, after.filtersToDone);
    process.stdout.write(`  output                            ${before.digest}  ${after.digest}` +
        `${before.digest === after.digest ? '' : '  MISMATCH'}\n`);

    rows.push({ fixture: fixture.name, before, after });
}

process.stdout.write('\n');
if (parityBroken) {
    process.stdout.write('Output mismatch between the baseline and the current script — see tests/load-parity.test.mjs.\n');
}

await harness.close();
process.exit(parityBroken ? 1 : 0);
