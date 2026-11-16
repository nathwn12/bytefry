/*
 * Dropping a file anywhere but the stage.
 *
 * The stage is the only place that loads a file. Everywhere else the window has
 * to refuse the browser's default for a dropped file, which is to navigate to
 * it: in a plain browser that replaces the app and loses the render in
 * progress, and in the host the navigation is cancelled and the file is
 * swallowed with no feedback. These checks pin both halves — the drop the user
 * meant still loads, and the drop they missed is refused rather than acted on.
 *
 * Drops are dispatched twice over: as real input-level drags through CDP
 * `Input.dispatchDragEvent` (so the browser's own drag machinery runs), and as
 * untrusted `DragEvent`s, which is the only way to read `defaultPrevented` back
 * from the page.
 */
import { basename } from 'node:path';
import { PROBE } from './lib/probe.mjs';

const STAGE_DROP = 1;

function dragData(paths) {
    return { items: [], files: paths, dragOperationsMask: STAGE_DROP };
}

async function geometry(page) {
    return page.evaluateJson(`(() => {
        const stage = document.getElementById('stage').getBoundingClientRect();
        const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
        return JSON.stringify({
            stage: [stage.x, stage.y, stage.width, stage.height],
            sidebar: [sidebar.x, sidebar.y, sidebar.width, sidebar.height],
            header: [0, 0, window.innerWidth, 40]
        });
    })()`);
}

function inside(rect, fx = 0.5, fy = 0.5) {
    return [Math.round(rect[0] + rect[2] * fx), Math.round(rect[1] + rect[3] * fy)];
}

/** A real drag: enter, move over, release. Returns nothing; the page decides. */
async function realDrag(page, [x, y], filePath) {
    const data = dragData([filePath]);
    await page.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
    await page.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
    await page.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });
}

/** Loads an image through the real stage drop path and waits for a render. */
async function loadOnStage(page, [x, y], filePath, label) {
    await page.evaluate(`window.__t.beginLoad(${JSON.stringify(label)})`);
    await realDrag(page, [x, y], filePath);
    await page.waitFor('!document.getElementById("dl-btn").disabled', 30000);
}

export const name = 'drop-safety';

export async function run({ browser, base, appPath }) {
    const checks = [];
    const page = await browser.openPage(`${base}/current/index.html`);
    await page.waitFor('document.readyState === "complete"');
    await page.evaluate(PROBE);

    const geo = await geometry(page);
    const sidebarPoint = inside(geo.sidebar, 0.5, 0.2);
    const headerPoint = inside(geo.header, 0.5, 0.5);
    const stagePoint = inside(geo.stage, 0.5, 0.5);

    // A file dragged over the sidebar must be shown as not droppable, not as a
    // drop target that does nothing.
    await page.evaluate(`(() => {
        window.__dragSeen = [];
        // Bubble phase on window, so this runs after the app's own window-level
        // handlers and can read what they decided.
        window.addEventListener('dragenter', e => window.__dragSeen.push(['enter', e.defaultPrevented]));
        window.addEventListener('dragover', e => {
            window.__dragSeen.push(['over', e.defaultPrevented, e.dataTransfer.dropEffect]);
        });
        return true;
    })()`);
    await page.send('Input.dispatchDragEvent', { type: 'dragEnter', x: sidebarPoint[0], y: sidebarPoint[1], data: dragData([appPath]) });
    await page.send('Input.dispatchDragEvent', { type: 'dragOver', x: sidebarPoint[0], y: sidebarPoint[1], data: dragData([appPath]) });
    const seen = await page.evaluateJson('JSON.stringify(window.__dragSeen)');

    checks.push({
        name: 'a file dragged over the sidebar is claimed by the page, not the browser',
        ok: seen.some(row => row[0] === 'over' && row[1] === true),
        detail: JSON.stringify(seen)
    });
    checks.push({
        name: 'the drag over the sidebar reads as not droppable',
        ok: seen.some(row => row[0] === 'over' && row[1] === true && row[2] === 'none'),
        detail: seen.map(row => row.join(':')).join(' | ')
    });

    // An untrusted drop outside the stage: the page must call preventDefault on
    // it. That is the whole guarantee — the default is the browser navigating
    // away to the file.
    const outsideDrop = await page.evaluateJson(`(() => {
        const bytes = new Uint8Array(64);
        const file = new File([bytes], 'not-an-image.png', { type: 'image/png' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        const events = [];
        for (const target of [document.body, document.querySelector('.sidebar')]) {
            const enter = new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer });
            target.dispatchEvent(enter);
            const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
            target.dispatchEvent(over);
            const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
            target.dispatchEvent(drop);
            events.push([enter.defaultPrevented, over.defaultPrevented, drop.defaultPrevented]);
        }
        return JSON.stringify({
            events,
            status: document.getElementById('statustext').textContent,
            save: document.getElementById('dl-btn').disabled
        });
    })()`);

    checks.push({
        name: 'a file dropped outside the stage is prevented from navigating',
        ok: outsideDrop.events.every(row => row[0] === true && row[1] === true && row[2] === true),
        detail: 'enter/over/drop prevented: ' + JSON.stringify(outsideDrop.events)
    });
    checks.push({
        name: 'a file dropped outside the stage is not loaded',
        ok: outsideDrop.save === true &&
            await page.evaluate('document.getElementById("image-meta").textContent === ""'),
        detail: await page.evaluate('"meta=" + document.getElementById("image-meta").textContent')
    });
    checks.push({
        name: 'a file dropped outside the stage says where it belongs',
        ok: outsideDrop.status === 'Drop an image on the stage.',
        detail: `status "${outsideDrop.status}"`
    });

    // A real drop on the stage still loads, renders and exports.
    await loadOnStage(page, stagePoint, appPath, 'stage drop');
    const loaded = await page.evaluateJson(`JSON.stringify({
        meta: document.getElementById('image-meta').textContent,
        size: document.getElementById('canvas').width + 'x' + document.getElementById('canvas').height,
        save: document.getElementById('dl-btn').disabled,
        status: document.getElementById('statustext').textContent
    })`);
    const before = await page.evaluate('window.__t.digest()');
    const titleBefore = await page.evaluate('document.title');

    checks.push({
        name: 'a file dropped on the stage still loads and becomes exportable',
        ok: loaded.save === false && loaded.status === 'Done' && new RegExp(basename(appPath).replace('.', '\\.')).test(loaded.meta),
        detail: JSON.stringify(loaded)
    });

    // The render in progress is the work a stray drop must not destroy.
    await realDrag(page, sidebarPoint, appPath);
    await new Promise(resolve => setTimeout(resolve, 250));
    const afterSidebar = await page.evaluateJson(`JSON.stringify({
        url: location.href,
        title: document.title,
        meta: document.getElementById('image-meta').textContent,
        save: document.getElementById('dl-btn').disabled,
        status: document.getElementById('statustext').textContent,
        digest: window.__t.digest()
    })`);
    checks.push({
        name: 'a real drop on the sidebar leaves the page and the render untouched',
        ok: afterSidebar.url.endsWith('/current/index.html') && afterSidebar.title === titleBefore &&
            afterSidebar.save === false && afterSidebar.meta === loaded.meta &&
            afterSidebar.digest === before,
        detail: JSON.stringify({ url: afterSidebar.url, title: afterSidebar.title, meta: afterSidebar.meta === loaded.meta, save: afterSidebar.save, sameDigest: afterSidebar.digest === before })
    });
    await realDrag(page, headerPoint, appPath);
    await new Promise(resolve => setTimeout(resolve, 250));
    const afterHeader = await page.evaluateJson(`JSON.stringify({
        url: location.href,
        save: document.getElementById('dl-btn').disabled,
        digest: window.__t.digest()
    })`);
    checks.push({
        name: 'a real drop on the header leaves the page and the render untouched',
        ok: afterHeader.url.endsWith('/current/index.html') && afterHeader.save === false && afterHeader.digest === before,
        detail: JSON.stringify({ url: afterHeader.url, sameDigest: afterHeader.digest === before })
    });

    await page.close();
    return { checks };
}
