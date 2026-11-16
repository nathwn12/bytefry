#!/usr/bin/env node
/*
 * The web-layer suite: headless, no window, no dependency, no network.
 *
 *   node tests/run.mjs                 # every test, on the current app/
 *   node tests/run.mjs drop-safety     # one test by name
 *   FRYER_APP_JS=<path> node tests/run.mjs
 *                                      # run the suite against another app.js,
 *                                      # which is how the checks are shown to
 *                                      # fail on the behaviour they describe
 *
 * This is the command CI should run. It contains no wall-clock assertions, so a
 * busy machine cannot turn it red. Speed is measured separately by
 * `node tests/bench.mjs`, which reports numbers and is not a gate.
 *
 * Exit code 0 means every check passed.
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createHarness, testsRoot } from './lib/harness.mjs';

const TESTS = ['drop-safety', 'load-parity', 'export-lock', 'export-failure'];

const only = process.argv[2];
const selected = only ? TESTS.filter(name => name === only) : TESTS;
if (!selected.length) {
    console.error(`unknown test; one of: ${TESTS.join(', ')}`);
    process.exit(2);
}

const harness = await createHarness();
let passed = 0;
let failed = 0;

for (const test of selected) {
    const module = await import(pathToFileURL(join(testsRoot, `${test}.test.mjs`)).href);
    process.stdout.write(`\n${module.name}\n`);
    try {
        const result = await module.run(harness);
        for (const check of result.checks) {
            if (check.ok) passed += 1;
            else failed += 1;
            process.stdout.write(`  ${check.ok ? 'ok  ' : 'FAIL'}  ${check.name}\n`);
            if (!check.ok && check.detail) process.stdout.write(`        ${check.detail}\n`);
        }
        if (result.notes) {
            for (const note of result.notes) process.stdout.write(`  ..    ${note}\n`);
        }
    } catch (error) {
        failed += 1;
        process.stdout.write(`  FAIL  ${test} threw\n        ${String(error.stack || error).split('\n')[0]}\n`);
    }
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);

await harness.close();
process.exit(failed ? 1 : 0);
