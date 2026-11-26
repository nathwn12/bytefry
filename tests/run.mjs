#!/usr/bin/env node
/*
 * The web-layer suite: headless, no window, no dependency, no network.
 *
 *   node tests/run.mjs                 # every test, on the current app/
 *   node tests/run.mjs bulge-radius    # one test by name: drop-safety,
 *                                      # load-parity, export-lock,
 *                                      # export-failure, export-quality,
 *                                      # bulge-radius
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

const TESTS = ['drop-safety', 'load-parity', 'export-lock', 'export-failure', 'export-quality', 'bulge-radius'];

const only = process.argv[2];
const selected = only ? TESTS.filter(name => name === only) : TESTS;
if (!selected.length) {
    console.error(`unknown test; one of: ${TESTS.join(', ')}`);
    process.exit(2);
}

let passed = 0;
let failed = 0;
const failures = [];

let harness;
try {
    harness = await createHarness();
} catch (error) {
    failed += 1;
    const stack = String(error.stack || error).split('\n');
    failures.push({ block: 'harness', name: 'browser launch', detail: stack[0], frame: stack[1] });
}

/* No browser means no block to run; the launch failure still reaches the
 * named-line and summary output below. */
for (const test of harness ? selected : []) {
    const module = await import(pathToFileURL(join(testsRoot, `${test}.test.mjs`)).href);
    process.stdout.write(`\n${module.name}\n`);
    try {
        const result = await module.run(harness);
        for (const check of result.checks) {
            if (check.ok) passed += 1;
            else {
                failed += 1;
                failures.push({ block: module.name, name: check.name, detail: check.detail });
            }
            process.stdout.write(`  ${check.ok ? 'ok  ' : 'FAIL'}  ${check.name}\n`);
            if (!check.ok && check.detail) process.stdout.write(`        ${check.detail}\n`);
        }
        if (result.notes) {
            for (const note of result.notes) process.stdout.write(`  ..    ${note}\n`);
        }
    } catch (error) {
        failed += 1;
        const stack = String(error.stack || error).split('\n');
        failures.push({ block: module.name, name: `${test} threw`, detail: stack[0], frame: stack[1] });
        process.stdout.write(`  FAIL  ${test} threw\n        ${stack[0]}\n`);
    }
}

/* A named line per failure, so a red check can be triaged from the log alone. */
for (const failure of failures) {
    const first = String(failure.detail || '').split('\n')[0];
    process.stdout.write(`not ok  ${failure.block}  ${failure.name}  -- ${first}\n`);
    if (failure.frame) process.stdout.write(`        ${failure.frame.trim()}\n`);
}
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);

if (harness) await harness.close();
process.exit(failed ? 1 : 0);
