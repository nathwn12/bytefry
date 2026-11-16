/*
 * Shared setup for the web-layer suite and the benchmark.
 *
 * Builds a scratch tree, generates the fixtures, stages `app/` twice (once with
 * the current `app.js`, once with the baseline copy), serves it on loopback and
 * launches one headless browser. Callers must `await harness.close()`.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';
import { serve, stageApp } from './app.mjs';
import { makeFixtures, makePhotoJpeg } from '../fixtures/make-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '..', '..');
export const testsRoot = join(here, '..');

export async function createHarness() {
    const appDir = join(repoRoot, 'app');
    const scratch = mkdtempSync(join(tmpdir(), 'fryer-tests-'));
    const fixtures = makeFixtures(join(scratch, 'fixtures'));

    const browser = await launch();

    /* The largest fixture has to be encoded by a real JPEG encoder, so it is
     * made in the browser that runs the tests rather than shipped as a binary. */
    const encoder = await browser.openPage('about:blank');
    fixtures.push(await makePhotoJpeg(encoder, join(scratch, 'fixtures')));
    await encoder.close();

    const baselineScript = join(testsRoot, 'fixtures', 'app-baseline.js');
    stageApp({
        appDir,
        root: scratch,
        name: 'current',
        scriptPath: process.env.FRYER_APP_JS || undefined
    });
    if (existsSync(baselineScript)) {
        stageApp({ appDir, root: scratch, name: 'baseline', scriptPath: baselineScript });
    }

    const server = await serve(scratch);

    return {
        scratch,
        appDir,
        fixtures,
        browser,
        base: server.base,
        appPath: fixtures[0].path,
        baselineScript: existsSync(baselineScript) ? baselineScript : null,
        async close() {
            await browser.close();
            await server.close();
            rmSync(scratch, { recursive: true, force: true });
        }
    };
}
