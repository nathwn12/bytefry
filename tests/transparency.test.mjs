/*
 * Transparent PNG output, proven on the exported file.
 *
 * The claim is narrow and has to be measured where it is made: the bytes the
 * app hands the host. So this test decodes the data URL the app produced and
 * reads its alpha channel, instead of trusting the canvas, the mime string or
 * a screenshot. A source with a fully transparent border, an opaque middle and
 * a half-transparent strip goes through the real pipeline (filters, then a
 * bulge point), and the exported PNG has to still carry those three alphas.
 *
 * The JPEG path is the other half of the check: with default settings the
 * export must still be the same JPEG bytes the pre-change script produces, so
 * the existing behaviour is measured against the real baseline rather than a
 * remembered hash.
 *
 * Everything here is an equality or an ordering; nothing asserts a duration.
 * Byte-for-byte comparisons stay inside configurations the pipeline is
 * deterministic in: the bulge radius is the upstream's displayed-size formula,
 * so a JPEG made with a bulge can differ when the window layout moves, and that
 * is measured by neither the parity check here nor the baseline.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROBE } from './lib/probe.mjs';
import { decodePng } from './lib/png.mjs';
import { encodePngRgba, patternPixel } from './fixtures/make-fixtures.mjs';

const WIDTH = 800;
const HEIGHT = 600;
const FRAME = 140;                   // transparent border thickness, in pixels
const BAND = { from: 200, to: 260 }; // a half-transparent strip across the middle

/* Fixed sample points: in the border, in the opaque middle, and in the strip.
 * The bulge point sits at the centre and its default radius reaches none of the
 * border samples, so a transparent edge cannot be explained by the warp
 * sampling another part of the picture. */
const POINTS = {
    transparent: [20, 20],
    opaque: [400, 380],
    half: [400, 230]
};

/* A uniform, half-transparent source whose rows are all different: the legacy
 * edge smear duplicates a neighbouring row onto the first and last row, and on
 * a semi-transparent image an alpha-compositing draw instead blends the two and
 * raises the alpha there. Eight rows, eight distinct colours from 0/255, so a
 * premultiplied canvas round-trip is lossless. */
const EDGE_ROWS = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [0, 255, 255],
    [255, 0, 255],
    [255, 255, 255],
    [0, 0, 0]
];
const EDGE_ALPHA = 128;
const EDGE_SIZE = EDGE_ROWS.length;

function makeEdgeFixture(dir) {
    const path = join(dir, 'edges-8x8.png');
    writeFileSync(path, encodePngRgba(EDGE_SIZE, EDGE_SIZE, (x, y) => [
        ...EDGE_ROWS[y], EDGE_ALPHA
    ]));
    return { name: 'edges-8x8.png', path, width: EDGE_SIZE, height: EDGE_SIZE };
}

/* A 1px transparent border over an opaque middle. The border's own alpha is
 * what the upstream edge smear and the vendored sharpen kernel both overwrite. */
const BORDER_SIZE = 8;

function borderAlphaAt(x, y) {
    const edge = x === 0 || y === 0 || x === BORDER_SIZE - 1 || y === BORDER_SIZE - 1;
    return edge ? 0 : 255;
}

function makeBorderFixture(dir) {
    const path = join(dir, 'border-8x8.png');
    writeFileSync(path, encodePngRgba(BORDER_SIZE, BORDER_SIZE, (x, y) => [
        ...EDGE_ROWS[y], borderAlphaAt(x, y)
    ]));
    return { name: 'border-8x8.png', path, width: BORDER_SIZE, height: BORDER_SIZE };
}

/* Two rows: the shortest picture the kernel and the smear can be asked about. */
function makeTinyFixture(dir) {
    const path = join(dir, 'tiny-8x2.png');
    writeFileSync(path, encodePngRgba(8, 2, (x, y) => [...EDGE_ROWS[y], EDGE_ALPHA]));
    return { name: 'tiny-8x2.png', path, width: 8, height: 2 };
}

const pattern = patternPixel(WIDTH, HEIGHT);

function alphaAt(x, y) {
    const inside = x >= FRAME && x < WIDTH - FRAME && y >= FRAME && y < HEIGHT - FRAME;
    if (!inside) return 0;
    if (y >= BAND.from && y < BAND.to) return 128;
    return 255;
}

function makeAlphaFixture(dir) {
    const path = join(dir, 'alpha-800x600.png');
    writeFileSync(path, encodePngRgba(WIDTH, HEIGHT, (x, y) => {
        const [r, g, b] = pattern(x, y);
        return [r, g, b, alphaAt(x, y)];
    }));
    return { name: 'alpha-800x600.png', path, width: WIDTH, height: HEIGHT };
}

function maxChannelDifference(a, b) {
    return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

async function openApp(browser, base, variant) {
    const page = await browser.openPage(`${base}/${variant}/index.html`);
    await page.waitFor('document.readyState === "complete"');
    await page.evaluate(PROBE);
    await page.evaluate('window.__t.installHost()');
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

/* A finished render: export unlocked, status settled. Both are properties of
 * the app, not a wait for a duration. */
async function waitIdle(page) {
    await page.waitFor(
        'document.getElementById("statustext").textContent === "Done" &&' +
        ' document.getElementById("dl-btn").disabled === false', 180000);
}

async function loadAndWait(page, fixture) {
    await page.evaluate(`window.__t.beginLoad(${JSON.stringify(fixture.name)})`);
    await realDrag(page, await stagePoint(page), fixture.path);
    await page.evaluate('window.__t.ready(180000)');
    await waitIdle(page);
}

async function setCrushes(page, before, after) {
    await page.evaluateJson(`(() => {
        const beforeBox = document.getElementById('jpeg-before');
        const afterBox = document.getElementById('jpeg-after');
        beforeBox.checked = ${before ? 'true' : 'false'};
        afterBox.checked = ${after ? 'true' : 'false'};
        afterBox.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    })()`);
}

async function chooseFormat(page, value) {
    return page.evaluateJson(`(() => {
        const radio = document.querySelector('input[name="output-format"][value="${value}"]');
        if (!radio) return JSON.stringify({ present: false });
        radio.click();
        return JSON.stringify({
            present: true,
            disabled: radio.disabled,
            checked: radio.checked,
            save: document.getElementById('dl-btn').disabled
        });
    })()`);
}

/** Selects a format the app actually offers, and waits for that render. */
async function selectFormat(page, value) {
    const chosen = await chooseFormat(page, value);
    if (chosen.present && chosen.disabled === false) await waitIdle(page);
    return chosen;
}

async function outputState(page) {
    return page.evaluateJson(`(() => {
        const png = document.querySelector('input[name="output-format"][value="png"]');
        const jpeg = document.querySelector('input[name="output-format"][value="jpeg"]');
        const hint = document.getElementById('output-hint');
        return JSON.stringify({
            pngPresent: !!png,
            pngDisabled: png ? png.disabled : null,
            pngChecked: png ? png.checked : null,
            jpegChecked: jpeg ? jpeg.checked : null,
            hintHidden: hint ? hint.hidden : null,
            hint: hint ? hint.textContent.trim() : ''
        });
    })()`);
}

/** Presses Ctrl+S, then returns the payload the app handed the host. */
async function save(page) {
    await page.evaluate('window.__t.armEncodes()');
    await page.evaluate('window.__t.pressSave()');
    await page.waitFor('window.__t.saves.length > 0', 30000);
    const saved = await page.evaluateJson('window.__t.lastSave()');
    const encodes = await page.evaluateJson('window.__t.encodeList()');
    return { ...saved, encodes };
}

/** The decoded PNG, or null when the app handed over something else. The
 *  checks report that as a failure instead of throwing, so a run against a
 *  build without the feature still says what it found. */
function pngOf(result) {
    if (!/^data:image\/png;base64,/.test(result.dataUrl || '')) return null;
    const comma = result.dataUrl.indexOf(',');
    return decodePng(Buffer.from(result.dataUrl.slice(comma + 1), 'base64'));
}

async function changeFilter(page, id, delta) {
    await page.evaluateJson(`(() => {
        const input = document.getElementById(${JSON.stringify(id)});
        input.value = String(Number(input.value) + ${delta});
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    })()`);
}

/** Turns every filter off, so the pipeline is the edge smear and nothing else. */
async function zeroFilters(page) {
    await page.evaluateJson(`(() => {
        for (const id of ['f-brightness', 'f-contrast', 'f-sharpen', 'f-saturation', 'f-noise']) {
            const input = document.getElementById(id);
            input.value = '0';
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
    })()`);
    await waitIdle(page);
}

/** Every alpha the picture carries, so "uniform" can be checked, not assumed. */
function alphaSpread(png) {
    const seen = new Set();
    for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) seen.add(png.at(x, y)[3]);
    }
    return [...seen].sort((a, b) => a - b);
}

async function toggleBulge(page, on) {
    return page.evaluateJson(`(() => {
        const box = document.getElementById('unlock-bulges');
        if (box.checked !== ${on ? 'true' : 'false'}) box.click();
        return JSON.stringify({ checked: box.checked, disabled: box.disabled });
    })()`);
}

async function addNub(page) {
    await page.evaluate('document.getElementById("add-nub-btn").click()');
    await waitIdle(page);
}

async function removeNub(page) {
    await page.evaluate(`(() => {
        const nub = document.querySelector('#nubs .nub');
        if (!nub) return false;
        nub.focus();
        nub.dispatchEvent(new KeyboardEvent('keydown',
            { key: 'Delete', bubbles: true, cancelable: true }));
        return true;
    })()`);
    await waitIdle(page);
}

export const name = 'transparency';

export async function run({ browser, base, fixtures, scratch }) {
    const checks = [];
    const notes = [];
    const small = fixtures[0];
    const alphaFixture = makeAlphaFixture(join(scratch, 'fixtures'));

    const page = await openApp(browser, base, 'current');
    await loadAndWait(page, alphaFixture);

    /* ---- 1. the control, and the limit it states ---- */

    const loaded = await outputState(page);
    checks.push({
        name: 'the app offers a PNG output format',
        ok: loaded.pngPresent === true,
        detail: loaded.pngPresent ? 'found input[name="output-format"][value="png"]'
            : 'no PNG control exists, so there is nothing to select'
    });
    checks.push({
        name: 'PNG output is refused while a JPEG crush pass runs, and says why',
        ok: loaded.pngPresent === true && loaded.pngDisabled === true &&
            loaded.jpegChecked === true && loaded.hintHidden === false && loaded.hint.length > 0,
        detail: `png disabled ${loaded.pngDisabled}, jpeg selected ${loaded.jpegChecked}, ` +
            `hint "${loaded.hint}"`
    });

    /* A transparent JPEG is impossible by definition, and the app must not
     * pretend otherwise: with a crush pass on, the transparent source is
     * flattened into the same kind of JPEG as before. */
    const jpegOfTransparent = await save(page);
    checks.push({
        name: 'with a crush pass on, a transparent source is saved as a JPEG',
        ok: /^data:image\/jpeg;base64,/.test(jpegOfTransparent.dataUrl || '') &&
            jpegOfTransparent.mime === 'image/jpeg' &&
            /\.jpg$/.test(jpegOfTransparent.suggestedName || ''),
        detail: `mime ${jpegOfTransparent.mime}, name ${jpegOfTransparent.suggestedName}`
    });

    /* ---- 2. switch the crush off: PNG becomes available ---- */

    await setCrushes(page, false, false);
    await waitIdle(page);

    const available = await outputState(page);
    checks.push({
        name: 'with both crush passes off, PNG is selectable and the hint goes away',
        ok: available.pngDisabled === false && available.hintHidden === true,
        detail: `png disabled ${available.pngDisabled}, hint hidden ${available.hintHidden}`
    });

    const chosen = await chooseFormat(page, 'png');
    checks.push({
        name: 'choosing PNG re-encodes the source and locks the export until it finishes',
        ok: chosen.present === true && chosen.checked === true && chosen.save === true,
        detail: `checked ${chosen.checked}, save locked ${chosen.save}`
    });
    if (chosen.present && chosen.disabled === false) await waitIdle(page);

    /* ---- 3. the exported PNG carries the source alphas ---- */

    const pngSave = await save(page);
    const png = pngOf(pngSave);
    const transparent = png ? png.at(...POINTS.transparent) : null;
    const opaque = png ? png.at(...POINTS.opaque) : null;
    const half = png ? png.at(...POINTS.half) : null;
    const sourceOpaque = pattern(...POINTS.opaque);

    checks.push({
        name: 'the exported file is a PNG with a .png name',
        ok: /^data:image\/png;base64,/.test(pngSave.dataUrl || '') &&
            pngSave.mime === 'image/png' && /\.png$/.test(pngSave.suggestedName || ''),
        detail: `mime ${pngSave.mime}, name ${pngSave.suggestedName}`
    });
    checks.push({
        name: 'the exported PNG is the working size',
        ok: !!png && png.width === WIDTH && png.height === HEIGHT,
        detail: png ? `${png.width}x${png.height}, expected ${WIDTH}x${HEIGHT}`
            : 'the export was not a PNG, so there are no pixels to measure'
    });
    checks.push({
        name: 'the transparent border is still fully transparent',
        ok: !!transparent && transparent[3] === 0,
        detail: transparent ? `alpha ${transparent[3]} at ${POINTS.transparent.join(',')}`
            : 'the export was not a PNG'
    });
    checks.push({
        name: 'the opaque middle is still fully opaque',
        ok: !!opaque && opaque[3] === 255,
        detail: opaque ? `alpha ${opaque[3]} at ${POINTS.opaque.join(',')}`
            : 'the export was not a PNG'
    });
    checks.push({
        name: 'the half-transparent strip keeps its alpha',
        ok: !!half && Math.abs(half[3] - 128) <= 2,
        detail: half ? `alpha ${half[3]} at ${POINTS.half.join(',')}, expected 128`
            : 'the export was not a PNG'
    });
    checks.push({
        name: 'the filters ran on the pixels that kept their alpha',
        ok: !!opaque && maxChannelDifference(opaque, sourceOpaque) >= 8,
        detail: opaque ? `exported ${opaque.slice(0, 3).join(',')} against source ${sourceOpaque.join(',')}`
            : 'the export was not a PNG'
    });
    checks.push({
        name: 'the PNG export path encodes no JPEG at all',
        ok: pngSave.encodes.length === 1 && pngSave.encodes[0][0] === 'image/png',
        detail: JSON.stringify(pngSave.encodes)
    });

    /* ---- 4. a processing change still reaches the PNG ---- */

    await changeFilter(page, 'f-brightness', 10);
    await waitIdle(page);
    const brighterSave = await save(page);
    const brighter = pngOf(brighterSave);
    const brighterOpaque = brighter ? brighter.at(...POINTS.opaque) : null;
    checks.push({
        name: 'changing a filter changes the exported PNG',
        ok: !!opaque && !!brighterOpaque &&
            (brighterOpaque[0] !== opaque[0] || brighterOpaque[1] !== opaque[1] ||
                brighterOpaque[2] !== opaque[2]),
        detail: opaque && brighterOpaque
            ? `${opaque.slice(0, 3).join(',')} -> ${brighterOpaque.slice(0, 3).join(',')}`
            : 'the export was not a PNG'
    });
    checks.push({
        name: 'a re-render keeps the transparent border transparent',
        ok: !!brighter && brighter.at(...POINTS.transparent)[3] === 0,
        detail: brighter ? 'the second export must not have been flattened by the re-render'
            : 'the export was not a PNG'
    });

    /* ---- 5. a crush pass takes PNG away, and JPEG is what comes out ---- */

    await setCrushes(page, false, true);
    await waitIdle(page);
    const fellBack = await outputState(page);
    checks.push({
        name: 'a crush pass turns PNG off rather than saving an opaque PNG',
        ok: fellBack.pngChecked === false && fellBack.pngDisabled === true &&
            fellBack.jpegChecked === true && fellBack.hintHidden === false,
        detail: `png checked ${fellBack.pngChecked}, disabled ${fellBack.pngDisabled}, ` +
            `jpeg checked ${fellBack.jpegChecked}`
    });

    const jpegAgain = await save(page);
    checks.push({
        name: 'that fallback saves a JPEG',
        ok: /^data:image\/jpeg;base64,/.test(jpegAgain.dataUrl || '') &&
            jpegAgain.mime === 'image/jpeg',
        detail: `mime ${jpegAgain.mime}, name ${jpegAgain.suggestedName}`
    });

    /* ---- 6. the PNG detour leaves the JPEG path alone ---- */

    /* No bulge yet: the upstream bulge radius is a fraction of the displayed
     * canvas, and a layout change can move a JPEG's pixels. With no warp the
     * pipeline is deterministic, so the bytes can be compared exactly. */
    await setCrushes(page, false, false);
    await waitIdle(page);
    const backToPngChoice = await selectFormat(page, 'png');
    const backToPng = await save(page);
    await selectFormat(page, 'jpeg');
    await setCrushes(page, false, true);
    await waitIdle(page);
    const jpegLast = await save(page);

    checks.push({
        name: 'a PNG export after the fallback is still a PNG with the border transparent',
        ok: !!backToPngChoice.present && !!pngOf(backToPng) &&
            pngOf(backToPng).at(...POINTS.transparent)[3] === 0,
        detail: `mime ${backToPng.mime}`
    });
    checks.push({
        name: 'returning to JPEG reproduces the same JPEG bytes as before the PNG export',
        ok: jpegLast.dataUrl === jpegAgain.dataUrl,
        detail: `${jpegLast.dataUrl.length} chars after the detour, ` +
            `${jpegAgain.dataUrl.length} before`
    });

    /* ---- 7. the bulge warp keeps alpha, and is actually applied ---- */

    await setCrushes(page, false, false);
    await waitIdle(page);
    await selectFormat(page, 'png');

    const bulge = await toggleBulge(page, true);
    if (bulge.checked) {
        await waitIdle(page);
        const plainSave = await save(page);           // bulge enabled, no point
        const plain = pngOf(plainSave);

        await addNub(page);
        const warpedSave = await save(page);
        const warped = pngOf(warpedSave);

        await removeNub(page);
        const restoredSave = await save(page);
        const restored = pngOf(restoredSave);

        const edge = warped ? warped.at(...POINTS.transparent) : null;
        const middle = warped ? warped.at(...POINTS.opaque) : null;

        checks.push({
            name: 'the bulge warp keeps the transparent border transparent',
            ok: !!edge && edge[3] === 0,
            detail: edge ? `alpha ${edge[3]} at ${POINTS.transparent.join(',')}`
                : 'the export was not a PNG'
        });
        checks.push({
            name: 'the bulge warp keeps the opaque middle opaque',
            ok: !!middle && middle[3] === 255,
            detail: middle ? `alpha ${middle[3]} at ${POINTS.opaque.join(',')}`
                : 'the export was not a PNG'
        });
        checks.push({
            name: 'the bulge point changes the exported pixels',
            ok: !!plain && !!warped && !!middle && !!plain.at(...POINTS.opaque) &&
                maxChannelDifference(middle, plain.at(...POINTS.opaque)) > 0,
            detail: plain && middle
                ? `without a point ${plain.at(...POINTS.opaque).slice(0, 3).join(',')}, ` +
                    `with one ${middle.slice(0, 3).join(',')}`
                : 'the export was not a PNG'
        });
        checks.push({
            name: 'removing the point returns the same PNG bytes',
            ok: !!plain && !!restored && plainSave.dataUrl === restoredSave.dataUrl,
            detail: 'the warp must depend on the points, not on how many renders ran'
        });
    } else {
        notes.push('WebGL is unavailable in this browser, so the bulge half of the transparency check did not run.');
    }

    await page.close();

    /* ---- 8. rows and borders keep their own alpha ---- */

    /* Two upstream behaviours meet here. The edge smear rewrites the first and
     * last row with their neighbours, and the vendored sharpen kernel leaves
     * those two rows unwritten. Neither shows on an opaque JPEG; on PNG the
     * first moves the alpha a border row carries and the second erases it, and
     * on a two-row picture the two of them together erase the whole file. PNG
     * mode therefore keeps every row's own pixels and alpha, at any height. */
    const edgeFixture = makeEdgeFixture(join(scratch, 'fixtures'));
    const borderFixture = makeBorderFixture(join(scratch, 'fixtures'));
    const tinyFixture = makeTinyFixture(join(scratch, 'fixtures'));
    const rowOf = (png, y) => (png ? png.at(4, y).slice(0, 3) : null);
    const sameColour = (a, b) => !!a && !!b && a.every((value, i) => Math.abs(value - b[i]) <= 1);

    /* (a) eight distinct rows at one uniform alpha: every row keeps its own
     * pixels, so nothing is swapped into the first or last row. */
    const edgePage = await openApp(browser, base, 'current');
    await loadAndWait(edgePage, edgeFixture);
    await zeroFilters(edgePage);
    await setCrushes(edgePage, false, false);
    await waitIdle(edgePage);
    await selectFormat(edgePage, 'png');
    const edgeSave = await save(edgePage);
    const edgePng = pngOf(edgeSave);
    const alphas = edgePng ? alphaSpread(edgePng) : null;

    checks.push({
        name: 'a uniform semi-transparent PNG keeps one alpha, edges included',
        ok: !!alphas && alphas.length === 1 && alphas[0] === EDGE_ALPHA,
        detail: alphas ? `alphas present ${JSON.stringify(alphas)}, expected [${EDGE_ALPHA}]`
            : 'the export was not a PNG'
    });
    checks.push({
        name: 'every row keeps its own pixels, first and last included',
        ok: !!edgePng && EDGE_ROWS.every((row, y) => sameColour(rowOf(edgePng, y), row)),
        detail: edgePng ? 'a row was replaced by its neighbour' : 'the export was not a PNG'
    });

    await selectFormat(edgePage, 'jpeg');
    await selectFormat(edgePage, 'png');
    const edgeAgain = await save(edgePage);
    checks.push({
        name: 'running the pipeline again reproduces the same edge pixels',
        ok: edgeAgain.dataUrl === edgeSave.dataUrl,
        detail: edgePng ? `${edgeAgain.dataUrl.length} chars on the second run, ` +
            `${edgeSave.dataUrl.length} on the first` : 'the export was not a PNG'
    });
    await edgePage.close();

    /* (b) a transparent border over an opaque middle: the exported alpha has to
     * match the source at every pixel, with and without filtering. */
    const borderPage = await openApp(browser, base, 'current');
    await loadAndWait(borderPage, borderFixture);
    await zeroFilters(borderPage);
    await setCrushes(borderPage, false, false);
    await waitIdle(borderPage);
    await selectFormat(borderPage, 'png');
    const plainBorderSave = await save(borderPage);
    const plainBorder = pngOf(plainBorderSave);

    const alphaMismatch = (png) => {
        if (!png) return 'the export was not a PNG';
        const wrong = [];
        for (let y = 0; y < BORDER_SIZE; y++) {
            for (let x = 0; x < BORDER_SIZE; x++) {
                if (png.at(x, y)[3] !== borderAlphaAt(x, y)) {
                    wrong.push(`${x},${y}=${png.at(x, y)[3]}`);
                }
            }
        }
        return wrong.length ? `${wrong.length} pixels, first ${wrong[0]}` : '';
    };

    checks.push({
        name: 'a transparent border keeps its own alpha with no filters running',
        ok: !!plainBorder && alphaMismatch(plainBorder) === '',
        detail: alphaMismatch(plainBorder) || 'every pixel matches the source alpha'
    });
    checks.push({
        name: 'with no filters running, every visible pixel is the source pixel',
        ok: !!plainBorder && Array.from({ length: BORDER_SIZE }, (_, y) => y).every(y =>
            Array.from({ length: BORDER_SIZE }, (_, x) => x).every(x =>
                borderAlphaAt(x, y) !== 255 ||
                sameColour(plainBorder.at(x, y).slice(0, 3), EDGE_ROWS[y]))),
        detail: plainBorder ? 'a pixel inside the border changed' : 'the export was not a PNG'
    });

    await borderPage.evaluateJson(`(() => {
        const values = { 'f-brightness': '15', 'f-contrast': '155', 'f-sharpen': '83', 'f-noise': '18' };
        for (const [id, value] of Object.entries(values)) {
            const input = document.getElementById(id);
            input.value = value;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
    })()`);
    await waitIdle(borderPage);
    const filteredBorderSave = await save(borderPage);
    const filteredBorder = pngOf(filteredBorderSave);
    checks.push({
        name: 'the transparent border survives the default filters and the sharpen kernel',
        ok: !!filteredBorder && alphaMismatch(filteredBorder) === '',
        detail: alphaMismatch(filteredBorder) || 'every pixel matches the source alpha'
    });
    await borderPage.close();

    /* (c) two rows: the shortest picture, with the default processing, where
     * the smear would swap the file and the kernel would erase it. */
    const tinyPage = await openApp(browser, base, 'current');
    await loadAndWait(tinyPage, tinyFixture);
    await setCrushes(tinyPage, false, false);
    await waitIdle(tinyPage);
    await selectFormat(tinyPage, 'png');
    const tinySave = await save(tinyPage);
    const tinyPng = pngOf(tinySave);
    checks.push({
        name: 'a two-row semi-transparent PNG keeps both its rows and their alpha',
        ok: !!tinyPng && tinyPng.height === 2 && tinyPng.width === 8 &&
            [0, 1].every(y => tinyPng.at(4, y)[3] === EDGE_ALPHA &&
                sameColour(tinyPng.at(4, y).slice(0, 3), EDGE_ROWS[y])),
        detail: tinyPng
            ? `row 0 ${JSON.stringify(tinyPng.at(4, 0))}, row 1 ${JSON.stringify(tinyPng.at(4, 1))}`
            : 'the export was not a PNG'
    });
    await tinyPage.close();

    /* The uniform fixture with the default filters: the alpha restore must not
     * depend on a filter being switched off. */
    const filteredEdges = await openApp(browser, base, 'current');
    await loadAndWait(filteredEdges, edgeFixture);
    await setCrushes(filteredEdges, false, false);
    await waitIdle(filteredEdges);
    await selectFormat(filteredEdges, 'png');
    const filteredSave = await save(filteredEdges);
    const filteredPng = pngOf(filteredSave);
    const filteredAlphas = filteredPng ? alphaSpread(filteredPng) : null;
    checks.push({
        name: 'with the default filters on, a uniform semi-transparent PNG still has one alpha',
        ok: !!filteredAlphas && filteredAlphas.length === 1 && filteredAlphas[0] === EDGE_ALPHA,
        detail: filteredAlphas ? `alphas present ${JSON.stringify(filteredAlphas)}, expected [${EDGE_ALPHA}]`
            : 'the export was not a PNG'
    });
    await filteredEdges.close();

    /* ---- 9. with default settings the JPEG is the baseline script's JPEG ---- */

    const baseline = await openApp(browser, base, 'baseline');
    await loadAndWait(baseline, small);
    const baselineJpeg = await save(baseline);
    await baseline.close();

    const current = await openApp(browser, base, 'current');
    await loadAndWait(current, small);
    const currentJpeg = await save(current);
    await current.close();

    checks.push({
        name: 'the default export is still a JPEG',
        ok: /^data:image\/jpeg;base64,/.test(currentJpeg.dataUrl || '') &&
            currentJpeg.mime === 'image/jpeg' &&
            /\.jpg$/.test(currentJpeg.suggestedName || ''),
        detail: `mime ${currentJpeg.mime}, name ${currentJpeg.suggestedName}`
    });
    checks.push({
        name: 'the default JPEG is byte-identical to the pre-change script',
        ok: currentJpeg.dataUrl === baselineJpeg.dataUrl,
        detail: `${currentJpeg.dataUrl.length} chars now, ${baselineJpeg.dataUrl.length} before`
    });
    checks.push({
        name: 'the default JPEG export still encodes exactly one JPEG from the canvas',
        ok: currentJpeg.encodes.length === 1 && currentJpeg.encodes[0][0] === 'image/jpeg',
        detail: JSON.stringify(currentJpeg.encodes)
    });

    return { checks, notes };
}
