#!/usr/bin/env node
/**
 * Builds the Bytefry Windows desktop host and bundles the web app beside it.
 *
 * Publishes desktop/MemeFryer.Desktop and copies app/ (a sibling of desktop/) into the
 * output so the folder is self-contained: Bytefry.exe + app/. Nothing is published,
 * installed or signed.
 *
 * Options:
 *   --configuration <Debug|Release>   default Release
 *   --runtime <win-x64|win-arm64>     default win-x64
 *   --framework-dependent             needs the .NET 10 Desktop Runtime; small exe
 *   --no-single-file                  plain folder layout instead of one exe
 *   --installer                       compile the Inno Setup 6 installer
 *   --release                         every release asset: the installer, a portable zip and a
 *                                     source zip of the current commit (needs a clean worktree)
 *   --allow-missing-app               build the host shell without app/index.html
 *   --verify                          off-screen self-check against the built exe
 *   --out-root <dir>                  default desktop/dist
 *
 * Example:
 *   node desktop/build.mjs
 *   node desktop/build.mjs --framework-dependent --configuration Debug
 *   node desktop/build.mjs --installer
 *   node desktop/build.mjs --release
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSelfCheckReport } from './selfcheck-report.mjs';

const desktopDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(desktopDir);
const projectDir = join(desktopDir, 'MemeFryer.Desktop');
const project = join(projectDir, 'MemeFryer.Desktop.csproj');
const iconFile = join(projectDir, 'Assets', 'MemeFryer.ico');
const noticeFile = join(desktopDir, 'NOTICE.md');
const appSrc = join(repoRoot, 'app');
const stage = join(desktopDir, 'obj', 'stage');

const KNOWN = new Set([
  '--configuration',
  '--runtime',
  '--framework-dependent',
  '--no-single-file',
  '--installer',
  '--release',
  '--allow-missing-app',
  '--verify',
  '--out-root',
]);

function fail(message) {
  console.error(`build: ${message}`);
  process.exit(1);
}

function step(text) {
  console.log(`==> ${text}`);
}

function note(text) {
  console.log(`    ${text}`);
}

function parseArgs(argv) {
  const options = {
    configuration: 'Release',
    runtime: 'win-x64',
    frameworkDependent: false,
    singleFile: true,
    installer: false,
    release: false,
    allowMissingApp: false,
    verify: false,
    outRoot: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    let arg = argv[index];
    let inline = null;
    if (arg.startsWith('--') && arg.includes('=')) {
      const split = arg.indexOf('=');
      inline = arg.slice(split + 1);
      arg = arg.slice(0, split);
    }
    if (!KNOWN.has(arg)) fail(`unknown option ${arg}`);

    const value = () => {
      if (inline !== null) return inline;
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) fail(`${arg} needs a value`);
      index += 1;
      return next;
    };
    const flag = () => {
      if (inline !== null) return inline === 'true';
      return true;
    };

    if (arg === '--configuration') {
      options.configuration = value();
      if (!['Debug', 'Release'].includes(options.configuration)) {
        fail('--configuration must be Debug or Release');
      }
    } else if (arg === '--runtime') {
      options.runtime = value();
      if (!['win-x64', 'win-arm64'].includes(options.runtime)) {
        fail('--runtime must be win-x64 or win-arm64');
      }
    } else if (arg === '--framework-dependent') {
      options.frameworkDependent = flag();
    } else if (arg === '--no-single-file') {
      options.singleFile = !flag();
    } else if (arg === '--installer') {
      options.installer = flag();
    } else if (arg === '--release') {
      options.release = flag();
    } else if (arg === '--allow-missing-app') {
      options.allowMissingApp = flag();
    } else if (arg === '--verify') {
      options.verify = flag();
    } else if (arg === '--out-root') {
      options.outRoot = resolve(value());
    }
  }

  if (options.outRoot === null) options.outRoot = join(desktopDir, 'dist');
  return options;
}

function run(command, args, label, cwd) {
  const options = { stdio: 'inherit', windowsHide: true };
  if (cwd) options.cwd = cwd;
  const result = spawnSync(command, args, options);
  if (result.error) fail(`${label ?? command} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${label ?? command} failed with exit code ${result.status}`);
}

function capture(command, args, cwd) {
  const options = {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  };
  if (cwd) options.cwd = cwd;
  const result = spawnSync(command, args, options);
  return { status: result.status, stdout: (result.stdout ?? '').trim() };
}

/** Runs git against the repository this script lives in, whatever the caller's directory is. */
function git(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error) fail(`git could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const reason = (result.stderr ?? '').trim().split(/\r?\n/)[0];
    fail(`git ${args.join(' ')} failed${reason ? `: ${reason}` : ''}`);
  }
  return (result.stdout ?? '').trim();
}

/** Best effort, for BUILD-INFO: a build is not a release and must not need git. */
function gitStamp() {
  const head = capture('git', ['rev-parse', '--short', 'HEAD'], repoRoot);
  if (head.status !== 0 || !head.stdout) return 'unknown';
  const status = capture('git', ['status', '--porcelain'], repoRoot);
  const dirty = status.status === 0 && status.stdout.length > 0;
  return dirty ? `${head.stdout} (dirty worktree)` : head.stdout;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** The archive's entry list, as Windows' bsdtar reports it. */
function zipEntries(file) {
  const result = spawnSync('tar.exe', ['-tf', file], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error) fail(`tar.exe could not start: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`tar.exe could not list ${basename(file)}: ${(result.stderr ?? '').trim()}`);
  }
  return (result.stdout ?? '').split(/\r?\n/).filter((entry) => entry.length > 0);
}

/** An entry that escapes the archive's root, or lands outside the roots we packed, is a bad asset. */
function assertZipRoots(label, entries, roots) {
  for (const entry of entries) {
    if (entry.includes('\\')) fail(`${label} has a backslash in an entry: ${entry}`);
    if (entry.startsWith('/') || /^[A-Za-z]:/.test(entry) || entry.startsWith('./')) {
      fail(`${label} has an absolute entry path: ${entry}`);
    }
    if (entry.split('/').includes('..')) fail(`${label} has a traversing entry path: ${entry}`);
    if (!roots.has(entry.split('/')[0])) {
      fail(`${label} has an entry outside ${[...roots].join(', ')}: ${entry}`);
    }
  }
}

function buildPortableZip({ portable, file }) {
  const top = readdirSync(portable).sort();
  for (const required of ['Bytefry.exe', 'NOTICE.md', 'app']) {
    if (!top.includes(required)) fail(`the portable folder has no ${required}: ${portable}`);
  }

  step(`packing ${basename(file)} (tar.exe -a, entries at the archive root)`);
  rmSync(file, { force: true });
  run('tar.exe', ['-a', '-c', '-f', file, '-C', portable, ...top], 'tar.exe');

  const entries = zipEntries(file);
  assertZipRoots(basename(file), entries, new Set(top));
  for (const required of ['Bytefry.exe', 'NOTICE.md', 'BUILD-INFO.txt', 'app/index.html', 'app/LICENSE']) {
    if (!entries.includes(required)) fail(`the portable zip is missing ${required}`);
  }

  // A listing proves the names, not the bytes: unpack it and compare what came back out.
  const proof = join(desktopDir, 'obj', 'release-check');
  rmSync(proof, { recursive: true, force: true });
  mkdirSync(proof, { recursive: true });
  try {
    run('tar.exe', ['-x', '-f', file, '-C', proof], 'tar.exe');
    for (const relative of ['Bytefry.exe', 'NOTICE.md', 'app/index.html', 'app/styles.css']) {
      if (sha256(join(proof, relative)) !== sha256(join(portable, relative))) {
        fail(`the portable zip does not round-trip ${relative}`);
      }
    }
  } finally {
    rmSync(proof, { recursive: true, force: true });
  }
}

function buildSourceZip({ file, version }) {
  const dirty = git(['status', '--porcelain']);
  if (dirty) {
    const lines = dirty.split(/\r?\n/).map((line) => `        ${line}`).join('\n');
    fail(`the worktree is not clean, so a source zip of HEAD would not be the tree this build came from:\n${lines}`);
  }

  const commit = git(['rev-parse', 'HEAD']);
  const prefix = `Bytefry-${version}/`;

  step(`packing ${basename(file)} from ${commit.slice(0, 12)} (git archive)`);
  rmSync(file, { force: true });
  run('git', ['archive', '--format=zip', `--prefix=${prefix}`, '-o', file, 'HEAD'], 'git archive', repoRoot);

  const entries = zipEntries(file);
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) fail(`the source zip has an entry outside ${prefix}: ${entry}`);
  }
  for (const required of [
    'README.md',
    'LICENSE',
    'app/index.html',
    'desktop/build.mjs',
    'desktop/tests/MemeFryer.Desktop.Tests/Program.cs',
  ]) {
    if (!entries.includes(prefix + required)) fail(`the source zip is missing ${required}`);
  }
  if (entries.some((entry) => entry.endsWith('.ps1'))) fail('the source zip carries a PowerShell script');

  return commit;
}

function versionFromProject(file) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/<Version>([^<]*)<\/Version>/g)) {
    const value = match[1].trim();
    if (value) return value;
  }
  return '0.0.0';
}

function directoryBytes(dir) {
  let bytes = 0;
  let files = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = directoryBytes(path);
      bytes += nested.bytes;
      files += nested.files;
    } else if (entry.isFile()) {
      bytes += statSync(path).size;
      files += 1;
    }
  }
  return { bytes, files };
}

/** The PE header's Machine field, read the same way Windows reads it. */
function exeMachine(path) {
  const buffer = readFileSync(path).subarray(0, 4096);
  if (buffer.length < 0x40) fail(`file is too small to be a PE image: ${path}`);
  const peOffset = buffer.readInt32LE(0x3c);
  if (peOffset < 0 || peOffset + 6 > buffer.length) fail(`no PE header found in ${path}`);
  if (buffer[peOffset] !== 0x50 || buffer[peOffset + 1] !== 0x45) fail(`not a PE image: ${path}`);
  return buffer.readUInt16LE(peOffset + 4);
}

function webView2Version() {
  // Best effort: this field only describes the machine that produced the build.
  const keys = capture('reg', [
    'query',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients',
    '/s',
  ]);
  if (keys.status === 0) {
    let current = null;
    let isWebView2 = false;
    for (const line of keys.stdout.split(/\r?\n/)) {
      const key = /^\s*name\s+REG_SZ\s+(.+)$/i.exec(line);
      if (key) {
        isWebView2 = key[1].trim() === 'Microsoft Edge WebView2 Runtime';
        current = null;
      }
      const pv = /^\s*pv\s+REG_SZ\s+(.+)$/i.exec(line);
      if (pv) {
        current = pv[1].trim();
        if (isWebView2) return current;
      }
    }
  }

  const runtimeDir = 'C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application';
  try {
    const versions = readdirSync(runtimeDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+\./.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => compareVersions(right, left));
    return versions[0] ?? null;
  } catch {
    return null;
  }
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function findIscc() {
  const onPath = capture('where.exe', ['iscc']);
  if (onPath.status === 0 && onPath.stdout) {
    const first = onPath.stdout.split(/\r?\n/)[0].trim();
    if (first) return first;
  }
  for (const candidate of [
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const portable = join(options.outRoot, 'portable');
  const releaseDir = join(options.outRoot, 'release');
  // --release compiles the installer into the folder it hands over, so one folder is the release.
  const installerOut = options.release ? releaseDir : join(options.outRoot, 'installer');

  // --- preconditions ---------------------------------------------------------
  if (!existsSync(project)) fail(`project file missing: ${project}`);
  if (!existsSync(iconFile)) fail(`icon missing: ${iconFile}`);
  if (!existsSync(noticeFile)) fail(`licence notice missing: ${noticeFile}`);

  // A source zip is only the tree that was built if nothing is uncommitted, so ask before the
  // publish rather than after 48 MB of work.
  let releaseCommit = null;
  if (options.release) {
    const dirty = git(['status', '--porcelain']);
    if (dirty) {
      const lines = dirty.split(/\r?\n/).map((line) => `    ${line}`).join('\n');
      fail(`--release needs a clean worktree; commit or stash first:\n${lines}`);
    }
    releaseCommit = git(['rev-parse', 'HEAD']);
    rmSync(releaseDir, { recursive: true, force: true });
    mkdirSync(releaseDir, { recursive: true });
    step(`release build from ${releaseCommit.slice(0, 12)} (worktree clean)`);
  }

  const sdk = capture('dotnet', ['--version']);
  if (sdk.status !== 0 || !sdk.stdout) fail('the .NET SDK could not report its version');
  step(`dotnet SDK ${sdk.stdout}`);

  const version = versionFromProject(project);
  note(`host version ${version}`);

  const appEntry = join(appSrc, 'index.html');
  const appReady = existsSync(appEntry);
  if (!appReady) {
    if (!options.allowMissingApp) {
      fail(
        `app/index.html not found at ${appEntry}. The desktop build bundles app/ beside desktop/. ` +
          'Pass --allow-missing-app to build the host alone.',
      );
    }
    console.warn('app/index.html missing: publishing the host shell without an app bundle.');
  }

  // --- publish ---------------------------------------------------------------
  rmSync(stage, { recursive: true, force: true });

  const publishArgs = [
    'publish',
    project,
    '-c',
    options.configuration,
    '-r',
    options.runtime,
    '--nologo',
    '-o',
    stage,
    '--self-contained',
    options.frameworkDependent ? 'false' : 'true',
    `-p:Version=${version}`,
    '-p:PublishTrimmed=false',
    '-p:DebugType=none',
  ];
  if (options.singleFile) {
    publishArgs.push('-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true');
    if (!options.frameworkDependent) {
      publishArgs.push('-p:EnableCompressionInSingleFile=true');
    }
  }

  step(
    `dotnet publish (${options.configuration}, ${options.runtime}, self-contained=${!options.frameworkDependent}, single-file=${options.singleFile})`,
  );
  run('dotnet', publishArgs, 'dotnet publish');

  // --- bundle app/ -----------------------------------------------------------
  if (appReady) {
    step('bundling app/ -> app/');
    const appDest = join(stage, 'app');
    // The old copy was a mirror: stale files in the destination had to go.
    rmSync(appDest, { recursive: true, force: true });
    cpSync(appSrc, appDest, { recursive: true });
    if (!existsSync(join(appDest, 'index.html'))) {
      fail(`app/index.html did not survive the copy into ${appDest}`);
    }
  }

  // --- bundle the host's licence notice --------------------------------------
  // The GPL text and the vendored-library notices arrive with app/. The host's own notice — its
  // licence and the components compiled into the exe — has to travel with the bundle too, or a
  // distributable ships a binary whose dependencies are never named.
  step('bundling NOTICE.md -> NOTICE.md');
  copyFileSync(noticeFile, join(stage, 'NOTICE.md'));

  // --- build info ------------------------------------------------------------
  let appStats = { files: 0, bytes: 0 };
  if (existsSync(join(stage, 'app'))) appStats = directoryBytes(join(stage, 'app'));

  const webView2 = webView2Version();
  const info = [
    'Bytefry desktop host',
    'licence:         GPL-3.0-only (see NOTICE.md and app\\LICENSE)',
    `version:         ${version}`,
    `commit:          ${releaseCommit ?? gitStamp()}`,
    `built (UTC):     ${new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')}`,
    `configuration:   ${options.configuration}`,
    `runtime:         ${options.runtime}`,
    `self-contained:  ${!options.frameworkDependent}`,
    `single-file:     ${options.singleFile}`,
    `dotnet SDK:      ${sdk.stdout}`,
    `webview2 runtime: ${webView2 ?? 'not detected (required at run time)'}`,
    `app files:       ${appStats.files} files, ${(appStats.bytes / 1024).toFixed(1)} KB`,
    '',
    'Portable: keep app\\ beside Bytefry.exe. Requires the Microsoft Edge WebView2 Runtime.',
    'No network access is used at run time; UI state lives in %LOCALAPPDATA%\\MemeFryer.',
    'That profile folder keeps the pre-rename name on purpose, so an installed copy upgrades in',
    'place with its WebView2 profile, and the uninstaller leaves it alone.',
  ].join('\n');
  writeFileSync(join(stage, 'BUILD-INFO.txt'), `${info}\n`, { encoding: 'utf8' });

  // --- promote to dist -------------------------------------------------------
  step(`publishing to ${portable}`);
  rmSync(portable, { recursive: true, force: true });
  mkdirSync(options.outRoot, { recursive: true });
  renameSync(stage, portable);

  const exe = join(portable, 'Bytefry.exe');
  if (!existsSync(exe)) fail(`Bytefry.exe was not produced in ${portable}`);

  const total = directoryBytes(portable);
  note(`Bytefry.exe: ${(statSync(exe).size / 1024 / 1024).toFixed(1)} MB`);
  note(`portable total: ${(total.bytes / 1024 / 1024).toFixed(1)} MB`);

  // The published PE machine must match the requested runtime: a wrong runtime pack or a stale bin
  // directory is otherwise invisible until the exe refuses to start on the target.
  const expectedMachine = { 'win-x64': 0x8664, 'win-arm64': 0xaa64 }[options.runtime];
  const machine = exeMachine(exe);
  if (machine !== expectedMachine) {
    fail(
      `Bytefry.exe is machine 0x${machine.toString(16).toUpperCase().padStart(4, '0')} but ${options.runtime} needs 0x${expectedMachine.toString(16).toUpperCase().padStart(4, '0')}`,
    );
  }
  note(`PE machine: 0x${machine.toString(16).toUpperCase().padStart(4, '0')} (${options.runtime})`);

  // --- installer -------------------------------------------------------------
  let setupAsset = null;
  if (options.installer || options.release) {
    const iscc = findIscc();
    if (!iscc) {
      fail('Inno Setup 6 compiler (ISCC.exe) not found; install Inno Setup 6 or drop --installer.');
    }

    step(`compiling installer with ${iscc}`);
    mkdirSync(installerOut, { recursive: true });
    const iss = join(desktopDir, 'installer', 'MemeFryer.iss');

    // The installer's architecture restriction must follow the payload, never a fixed x64 default.
    const innoArchitecture = { 'win-x64': 'x64compatible', 'win-arm64': 'arm64' }[options.runtime];
    note(`installer architecture: ${innoArchitecture}`);

    run(
      iscc,
      [
        `/DMyAppVersion=${version}`,
        `/DMyArch=${innoArchitecture}`,
        `/DSourceDir=${portable}`,
        `/DOutDir=${installerOut}`,
        `/DIconFile=${iconFile}`,
        iss,
      ],
      'ISCC',
    );

    const setups = readdirSync(installerOut)
      .filter((name) => name.startsWith('Bytefry-') && name.endsWith('-setup.exe'))
      .map((name) => ({ name, time: statSync(join(installerOut, name)).mtimeMs }))
      .sort((left, right) => right.time - left.time);
    if (setups.length === 0) fail(`installer output missing in ${installerOut}`);
    const setup = setups[0];
    setupAsset = join(installerOut, setup.name);
    if (!options.release) note(`${setup.name} (${(statSync(setupAsset).size / 1024 / 1024).toFixed(1)} MB)`);
  }

  // --- release assets --------------------------------------------------------
  //
  // One command, three files, each checked by what it actually contains: the installer, a portable
  // zip whose entries sit at the archive root, and a source zip of the exact commit built here.
  if (options.release) {
    const portableTag = options.runtime === 'win-x64' ? 'x64' : 'arm64';
    const portableZip = join(releaseDir, `Bytefry-${version}-portable-${portableTag}.zip`);
    buildPortableZip({ portable, file: portableZip });
    const sourceZip = join(releaseDir, `Bytefry-${version}-source.zip`);
    const commit = buildSourceZip({ file: sourceZip, version });
    if (commit !== releaseCommit) fail(`the source zip names ${commit} but this build started at ${releaseCommit}`);

    const assets = [
      ['installer', setupAsset],
      ['portable', portableZip],
      ['source', sourceZip],
    ];
    step(`release assets for ${version} at ${commit.slice(0, 12)}`);
    for (const [label, file] of assets) {
      if (!file || !existsSync(file)) fail(`the ${label} asset was not produced`);
      note(`${basename(file).padEnd(46)} ${(statSync(file).size / 1024 / 1024).toFixed(1)} MB  sha256 ${sha256(file)}`);
    }
    note(`source commit: ${commit}`);
  }

  console.log('');
  console.log(`build ok: ${portable}`);

  // --- off-screen self-check -------------------------------------------------
  //
  // The host needs a real window for WebView2 to compose, so this check parks one outside every
  // monitor and never activates it: nothing is visible and no focus is taken, but it is off-screen,
  // not headless. It is opt-in, and a green exit code alone is not proof: the report must exist,
  // parse and pass.
  if (options.verify) {
    if (!appReady) fail('--verify needs app/index.html; there is nothing for the host to load.');

    step('off-screen self-check (window outside every monitor, nothing visible)');
    const checkDir = join(desktopDir, 'obj', 'selfcheck');
    mkdirSync(checkDir, { recursive: true });
    const report = join(checkDir, 'report.json');
    rmSync(report, { force: true });

    const proc = spawnSync(exe, ['--selfcheck', report], { stdio: 'inherit', windowsHide: true });
    if (proc.error) fail(`self-check could not start: ${proc.error.message}`);

    const result = readSelfCheckReport({ path: report, exitCode: proc.status ?? -1 });
    for (const check of result.checks) note(`ok   ${check.name} - ${check.detail ?? ''}`);
    note(`report: ${report}`);
    console.log('self-check ok');
  }
}

main();
