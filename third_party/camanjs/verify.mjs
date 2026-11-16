// Verifies that the CamanJS bundle this app ships is the upstream v4.1.2 build,
// and that the source kept beside it is the source that build was made from.
//
// Offline and dependency-free: no network, no git, no build tools. Run it from
// anywhere:
//
//   node third_party/camanjs/verify.mjs
//
// Exit 0 means every assertion held. Exit 1 names the check that failed.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const shipped = join(repo, 'app', 'vendor', 'caman.full.min.js');
const upstream = join(here, 'upstream');
const artifact = join(upstream, 'dist', 'caman.full.min.js');

// Recorded facts. A change in any of these is a change in what ships.
const SHIPPED_SHA256 = '2994386943f69b79501cf8b38556bcb9d6cf80bdeb4abaedb5002958ef241aca';
const SHIPPED_BYTES = 78452;
const SHIPPED_CRLF = 238;
const LFSha256 = '4ed8fa29ed8dceec62e6ea4f9477ad919c41b5d4ead0b57567a044514b0a3dfb';
const LFBytes = 78214;
const LFGitBlob = '803c2ef65940a5eeca3babec178e5cfbd6348d52'; // upstream dist blob at v4.1.2
const VENDORED_FILES = 40;
const VENDORED_BYTES = 211901;

const failures = [];
const check = (ok, label, detail = '') => {
  if (!ok) failures.push(detail ? `${label}: ${detail}` : label);
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const gitBlob = (buf) =>
  createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

// 1. The shipped file is the committed bytes, CRLF and all.
const shippedBuf = readFileSync(shipped);
check(shippedBuf.length === SHIPPED_BYTES, 'shipped size', `${shippedBuf.length} != ${SHIPPED_BYTES}`);
check(sha256(shippedBuf) === SHIPPED_SHA256, 'shipped sha256', sha256(shippedBuf));

// 2. Line endings are the only difference from upstream: normalise, then match
//    the published artifact byte for byte.
const crlf = (shippedBuf.toString('latin1').match(/\r\n/g) ?? []).length;
check(crlf === SHIPPED_CRLF, 'shipped CRLF count', `${crlf} != ${SHIPPED_CRLF}`);
const lf = shippedBuf.toString('latin1').split('\r\n').join('\n');
const lfBuf = Buffer.from(lf, 'latin1');
check(lfBuf.length === LFBytes, 'normalised size', `${lfBuf.length} != ${LFBytes}`);
check(sha256(lfBuf) === LFSha256, 'normalised sha256', sha256(lfBuf));
check(gitBlob(lfBuf) === LFGitBlob, 'normalised git blob', gitBlob(lfBuf));

// 3. The vendored artifact is that same upstream build, and the shipped file
//    reduces to it exactly.
const artifactBuf = readFileSync(artifact);
check(Buffer.compare(artifactBuf, lfBuf) === 0, 'shipped file != vendored upstream artifact');

// 4. The vendored tree is complete: 40 files, the recorded byte total.
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
const files = walk(upstream).sort();
check(files.length === VENDORED_FILES, 'vendored file count', `${files.length} != ${VENDORED_FILES}`);
const total = files.reduce((n, f) => n + readFileSync(f).length, 0);
check(total === VENDORED_BYTES, 'vendored byte total', `${total} != ${VENDORED_BYTES}`);

// 5. Source completeness. Every registration the sources declare must appear in
//    the bundle, and the bundle must hold nothing the sources do not declare.
//    CamanJS registers three kinds: filters, plugins and blenders.
const KINDS = ['Filter', 'Plugin', 'Blender'];
const declared = { Filter: new Set(), Plugin: new Set(), Blender: new Set() };
for (const file of files.filter((f) => f.endsWith('.coffee'))) {
  const text = readFileSync(file, 'utf8');
  for (const kind of KINDS) {
    const re = new RegExp(`(?:Caman\\.)?${kind}\\.register\\s*\\(?\\s*"([^"]+)"`, 'g');
    let m;
    while ((m = re.exec(text))) declared[kind].add(m[1]);
  }
}
const declaredCalls = Object.values(declared).reduce((n, s) => n + s.size, 0);

const bundleText = artifactBuf.toString('latin1');
const registered = new Set();
for (const m of bundleText.matchAll(/\bregister\s*\(\s*"([^"]+)"/g)) registered.add(m[1]);

const allDeclared = new Set([...declared.Filter, ...declared.Plugin, ...declared.Blender]);
for (const name of allDeclared) {
  check(registered.has(name), 'declared but absent from bundle', name);
}
for (const name of registered) {
  check(allDeclared.has(name), 'in bundle but not in vendored sources', name);
}
check(registered.size === allDeclared.size, 'registration set size', `${registered.size} != ${allDeclared.size}`);
check(
  declared.Filter.size + declared.Plugin.size + declared.Blender.size === 52 + 5 + 10,
  'declared registrations by kind',
  `${declared.Filter.size}/${declared.Plugin.size}/${declared.Blender.size}`,
);

if (failures.length) {
  console.error(`camanjs verify FAILED (${failures.length})`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

const rel = (p) => relative(here, p).split(sep).join('/');
console.log('camanjs verify ok');
console.log(`  ${rel(shipped)}  ${SHIPPED_BYTES} B, ${SHIPPED_CRLF} CRLF`);
console.log(`  = ${rel(artifact)} after CRLF->LF  ${LFBytes} B  blob ${LFGitBlob}`);
console.log(`  ${files.length} vendored files, ${VENDORED_BYTES} B`);
console.log(
  `  ${declared.Filter.size} filters + ${declared.Plugin.size} plugins + ${declared.Blender.size} blenders = ` +
    `${declaredCalls} registrations, all present in the bundle`,
);
