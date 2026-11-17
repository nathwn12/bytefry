#!/usr/bin/env node
/**
 * Runs the desktop host against app/ in the source tree (fast inner loop, no publish).
 *
 * Builds desktop/MemeFryer.Desktop in Debug and launches it with MEME_FRYER_DEV=1 (devtools,
 * context menus, browser accelerators) and MEME_FRYER_APP_DIR pointing at <repo>/app, so edits
 * to app/ are picked up on the next launch. Reload the page with Ctrl+R / F5 (dev only).
 *
 * Options:
 *   --no-build          launch the existing Debug build
 *   --app-dir <dir>     serve a different app folder (must contain index.html)
 *
 * Example:
 *   node desktop/run-dev.mjs
 *   node desktop/run-dev.mjs --no-build
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(desktopDir);
const project = join(desktopDir, 'MemeFryer.Desktop', 'MemeFryer.Desktop.csproj');

function fail(message) {
  console.error(`run-dev: ${message}`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  let noBuild = false;
  let appDir = join(repoRoot, 'app');

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--no-build') {
      noBuild = true;
    } else if (arg === '--app-dir') {
      appDir = resolve(args[index + 1] ?? '');
      index += 1;
      if (!args[index]) fail('--app-dir needs a value');
    } else {
      fail(`unknown option ${arg}`);
    }
  }

  if (!existsSync(join(appDir, 'index.html'))) {
    fail(`no index.html in ${appDir} - the app lane has not written it yet.`);
  }

  if (!noBuild) {
    console.log('==> dotnet build (Debug)');
    const build = spawnSync('dotnet', ['build', project, '-c', 'Debug', '--nologo'], {
      stdio: 'inherit',
      windowsHide: true,
    });
    if (build.error) fail(`dotnet build could not start: ${build.error.message}`);
    if (build.status !== 0) fail(`dotnet build failed with exit code ${build.status}`);
  }

  const candidates = [
    join(desktopDir, 'MemeFryer.Desktop', 'bin', 'Debug', 'net10.0-windows', 'win-x64', 'Bytefry.exe'),
    join(desktopDir, 'MemeFryer.Desktop', 'bin', 'Debug', 'net10.0-windows', 'Bytefry.exe'),
  ];
  const exe = candidates.find(existsSync);
  if (!exe) fail('Bytefry.exe not found under bin/Debug; run without --no-build.');

  console.log(`==> Bytefry.exe  (app: ${appDir})`);
  const run = spawnSync(exe, [], {
    stdio: 'inherit',
    env: { ...process.env, MEME_FRYER_DEV: '1', MEME_FRYER_APP_DIR: appDir },
    windowsHide: false,
  });
  if (run.error) fail(`Bytefry.exe could not start: ${run.error.message}`);
  process.exit(run.status ?? 1);
}

main();
