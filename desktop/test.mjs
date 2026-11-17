#!/usr/bin/env node
/**
 * Every window-free check for the desktop host, in one command.
 *
 * Runs, and fails on any red result:
 *   1. the C# suite (desktop/tests): app-folder resolution, the bridge host, the report writer,
 *      the injected script in Node against a fake chrome.webview, packaging invariants, and the
 *      host's command line (argument and app-bundle failures happen before any window exists);
 *   2. the self-check report gate (desktop/selfcheck-report.mjs) against fabricated reports, so a
 *      weakened gate turns this red.
 *
 * Nothing here creates a window. The off-screen `--selfcheck` route is NOT run by this script: it
 * needs a real window for WebView2 to compose, so it is opt-in through build.mjs --verify.
 *
 * Example:
 *   node desktop/test.mjs
 *   node desktop/test.mjs --configuration Release
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSelfCheckReport, SelfCheckError } from './selfcheck-report.mjs';

const desktopDir = dirname(fileURLToPath(import.meta.url));
const tempRoot = mkdtempSync(join(tmpdir(), 'bytefry-gate-'));

let failed = 0;

function ok(text) {
  console.log(`  ok    ${text}`);
}

function fail(text) {
  console.log(`  FAIL  ${text}`);
  failed += 1;
}

function heading(text) {
  console.log(text);
}

function expectReject(name, action, expected) {
  try {
    action();
    fail(`${name} (was accepted)`);
  } catch (error) {
    if (error instanceof SelfCheckError && error.message.includes(expected)) ok(name);
    else fail(`${name} (wrong reason: ${error.message})`);
  }
}

function writeReport(body, name = `report-${crypto.randomUUID()}.json`) {
  const path = join(tempRoot, name);
  writeFileSync(path, JSON.stringify(body), 'utf8');
  return path;
}

function main() {
  const args = process.argv.slice(2);
  let configuration = 'Debug';
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--configuration') {
      configuration = args[index + 1];
      index += 1;
      if (!['Debug', 'Release'].includes(configuration)) {
        console.error('test: --configuration must be Debug or Release');
        process.exit(1);
      }
    } else {
      console.error(`test: unknown option ${args[index]}`);
      process.exit(1);
    }
  }

  try {
    // 1. C# suite -------------------------------------------------------------
    heading('C# suite');
    const tests = join(desktopDir, 'tests', 'MemeFryer.Desktop.Tests');
    const result = spawnSync(
      'dotnet',
      ['run', '--project', tests, '-c', configuration, '--nologo'],
      { stdio: 'inherit', windowsHide: true },
    );
    if (result.error) fail(`dotnet run could not start: ${result.error.message}`);
    else if (result.status !== 0) fail(`dotnet run ${tests} exited ${result.status}`);
    else ok('C# suite');

    // 2. report gate ----------------------------------------------------------
    heading('self-check report gate');

    const good = writeReport({
      passed: true,
      checks: [{ name: 'a', ok: true, detail: '' }],
    });

    try {
      readSelfCheckReport({ path: good, exitCode: 0 });
      ok('a passing report with exit 0 is accepted');
    } catch (error) {
      fail(`a passing report was rejected: ${error.message}`);
    }

    expectReject(
      'a missing report is rejected',
      () => readSelfCheckReport({ path: join(tempRoot, 'nope.json'), exitCode: 0 }),
      'produced no report',
    );

    const broken = join(tempRoot, 'broken.json');
    writeFileSync(broken, '{not json', 'utf8');
    expectReject(
      'an unparsable report is rejected',
      () => readSelfCheckReport({ path: broken, exitCode: 0 }),
      'not valid JSON',
    );

    expectReject(
      'a report without passed is rejected',
      () => readSelfCheckReport({ path: writeReport({ checks: [{ name: 'a', ok: true }] }), exitCode: 0 }),
      "no 'passed' field",
    );

    expectReject(
      'passed=false is rejected even with a green exit code',
      () =>
        readSelfCheckReport({
          path: writeReport({ passed: false, checks: [{ name: 'a', ok: true }] }),
          exitCode: 0,
        }),
      'does not say passed=true',
    );

    expectReject(
      'one red check is rejected even when passed=true',
      () =>
        readSelfCheckReport({
          path: writeReport({
            passed: true,
            checks: [
              { name: 'a', ok: true },
              { name: 'b', ok: false, detail: 'x' },
            ],
          }),
          exitCode: 0,
        }),
      'failing check',
    );

    expectReject(
      'a report with no checks is rejected',
      () => readSelfCheckReport({ path: writeReport({ passed: true, checks: [] }), exitCode: 0 }),
      'contains no checks',
    );

    expectReject(
      'a passing report with a non-zero exit code is rejected',
      () => readSelfCheckReport({ path: good, exitCode: 1 }),
      'refusing to trust',
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log('');
  if (failed > 0) {
    console.log(`${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('all window-free checks passed');
}

main();
