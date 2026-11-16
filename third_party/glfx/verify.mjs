// Verifies that the glfx.js bundle this app ships is the pinned upstream build,
// and that the source kept beside it is the source that build was made from.
//
// glfx.js is a generated file, so the check is not "the file is in the
// repository" — it is "the file is the published artifact, line for line, apart
// from one header line the upstream build tool itself changed in 2022".
//
// Offline and dependency-free: no network, no git, no build tools. Run it from
// anywhere:
//
//   node third_party/glfx/verify.mjs
//
// Exit 0 means every assertion held. Exit 1 names the check that failed.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const shippedPath = join(repo, 'app', 'vendor', 'glfx.js');
const upstream = join(here, 'upstream');
const publishedPath = join(here, 'published', 'glfx.js');

// Recorded facts. A change in any of these is a change in what ships.
const SHIPPED_SHA256 = '68926beb1c83cf8eeaf9ff8e61030158ea27ca0bcfcd6028829a6fca2daa47a1';
const SHIPPED_BYTES = 28403;
const SHIPPED_CRLF = 59;
const NORM_SHA256 = '68869b90c50a54e9e5c0c76c575fef3da62cfd7a91b4a96dfff099473d30065c';
const NORM_BYTES = 28344;
const NORM_GIT_BLOB = 'f8f29ba7ef06f87a20797620862504f735fb5cc6';
const PUB_SHA256 = '14332d2b292a59e07d2cd3f86bf7e3baa4774a39fcc6ab36c0cba41532657ac3';
const PUB_GIT_BLOB = '5f812a18dbb868a8dbb2db0ff2336dbbf925eeae';
// The one line that may differ, and the two values it may hold.
const HEADER_LEGACY = ' * http://evanw.github.com/glfx.js/';
const HEADER_CURRENT = ' * https://evanw.github.io/glfx.js/';
const VENDORED_FILES = 34;
const VENDORED_BYTES = 98934;

const failures = [];
const check = (ok, label, detail = '') => {
  if (!ok) failures.push(detail ? `${label}: ${detail}` : label);
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const gitBlob = (buf) =>
  createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const count = (hay, needle) => hay.split(needle).length - 1;

// 1. The shipped file is the committed bytes, CRLF and all.
const shippedBuf = readFileSync(shippedPath);
const shipped = shippedBuf.toString('latin1');
check(shippedBuf.length === SHIPPED_BYTES, 'shipped size', `${shippedBuf.length} != ${SHIPPED_BYTES}`);
check(sha256(shippedBuf) === SHIPPED_SHA256, 'shipped sha256', sha256(shippedBuf));
check(count(shipped, '\r\n') === SHIPPED_CRLF, 'shipped CRLF count', `${count(shipped, '\r\n')} != ${SHIPPED_CRLF}`);
check(count(shipped, '\n') === SHIPPED_CRLF, 'shipped lone LF', `${count(shipped, '\n') - SHIPPED_CRLF} unpaired`);

// 2. Line endings are the only difference from the published artifact, and one
//    header line is the only difference after that.
const norm = shipped.split('\r\n').join('\n');
const normBuf = Buffer.from(norm, 'latin1');
check(normBuf.length === NORM_BYTES, 'normalised size', `${normBuf.length} != ${NORM_BYTES}`);
check(sha256(normBuf) === NORM_SHA256, 'normalised sha256', sha256(normBuf));
check(gitBlob(normBuf) === NORM_GIT_BLOB, 'normalised git blob', gitBlob(normBuf));

const publishedBuf = readFileSync(publishedPath);
const published = publishedBuf.toString('latin1');
check(publishedBuf.length === NORM_BYTES, 'published size', `${publishedBuf.length} != ${NORM_BYTES}`);
check(sha256(publishedBuf) === PUB_SHA256, 'published sha256', sha256(publishedBuf));
check(gitBlob(publishedBuf) === PUB_GIT_BLOB, 'published git blob', gitBlob(publishedBuf));

// 3. Exactly one line differs, and it is the header URL.
const a = norm.split('\n');
const b = published.split('\n');
check(a.length === b.length, 'line count', `${a.length} != ${b.length}`);
const differing = [];
for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) differing.push(i);
check(differing.length === 1, 'differing line count', `${differing.length} lines differ`);
if (differing.length === 1) {
  const i = differing[0];
  check(a[i] === HEADER_LEGACY, `line ${i + 1} is not the pinned legacy header`, JSON.stringify(a[i]));
  check(b[i] === HEADER_CURRENT, `line ${i + 1} is not the published header`, JSON.stringify(b[i]));
}

// 4. Swapping that line back makes the published artifact equal to what ships,
//    byte for byte — the whole claim, in one substitution.
check(count(published, HEADER_CURRENT) === 1, 'published header URL occurrences', String(count(published, HEADER_CURRENT)));
const rebuilt = Buffer.from(published.split(HEADER_CURRENT).join(HEADER_LEGACY), 'latin1');
check(Buffer.compare(rebuilt, normBuf) === 0, 'published artifact + legacy header != shipped file');
check(gitBlob(rebuilt) === NORM_GIT_BLOB, 'rebuilt git blob', gitBlob(rebuilt));

// 5. The pinned build tool is the one that writes that header line, so the
//    legacy line is the build's own output and not an edit someone made here.
const buildPy = readFileSync(join(upstream, 'build.py'), 'utf8');
check(count(buildPy, HEADER_LEGACY) === 1, 'build.py does not write the legacy header');
check(count(buildPy, HEADER_CURRENT) === 0, 'build.py writes both header URLs');

// 6. Source completeness. glfx has one entry point, exports.canvas, which
//    attaches every method to the canvas; the compiler keeps property names, so
//    each attached name must appear in the published artifact, and each backing
//    function must exist in the vendored sources.
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
const files = walk(here).filter((f) => !f.endsWith('BUILD.md') && !f.endsWith('verify.mjs'));
check(files.length === VENDORED_FILES, 'vendored file count', `${files.length} != ${VENDORED_FILES}`);
const total = files.reduce((n, f) => n + readFileSync(f).length, 0);
check(total === VENDORED_BYTES, 'vendored byte total', `${total} != ${VENDORED_BYTES}`);

const canvasJs = readFileSync(join(upstream, 'src', 'core', 'canvas.js'), 'utf8');
const attached = [...canvasJs.matchAll(/canvas\.(\w+)\s*=\s*wrap\((\w+)\)/g)].map((m) => ({
  name: m[1],
  fn: m[2],
}));
check(attached.length === 28, 'attached method count', String(attached.length));

const sources = walk(join(upstream, 'src'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

for (const { name, fn } of attached) {
  check(published.includes(`.${name}=`), 'attached method absent from published artifact', name);
  check(new RegExp(`function ${fn}\\s*\\(`).test(sources), 'attached method has no function in the vendored sources', `${name} -> ${fn}()`);
}

// 7. The pinned source and the 2022 commit it was superseded by differ only in
//    a comment URL and the header string. Comments are stripped by the release
//    build, so that difference cannot reach the output — which is why the pinned
//    source describes this artifact and not merely a similar one.
check(!published.includes('crbug.com'), 'published artifact still carries the commented crbug URL');

// 8. glfx.js is generated, not source: upstream's own .gitignore lists it, and
//    the published artifact carries none of the build's "// path" markers, so it
//    is the compiled output rather than the plain concatenation.
const gitignore = readFileSync(join(upstream, '.gitignore'), 'utf8');
check(gitignore.includes('/glfx.js'), 'upstream .gitignore does not list the generated glfx.js');
check(!published.includes('// src/'), 'published artifact still carries the build path markers');

if (failures.length) {
  console.error(`glfx verify FAILED (${failures.length})`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

const rel = (p) => relative(here, p).split(sep).join('/');
console.log('glfx verify ok');
console.log(`  ${rel(shippedPath)}  ${SHIPPED_BYTES} B, ${SHIPPED_CRLF} CRLF`);
console.log(`  = ${rel(publishedPath)} after CRLF->LF, header URL set to the legacy form`);
console.log(`    ${NORM_BYTES} B  blob ${NORM_GIT_BLOB}`);
console.log(`  published artifact alone: blob ${PUB_GIT_BLOB} (gh-pages 1bf5f4e)`);
console.log(`  ${files.length} vendored files, ${VENDORED_BYTES} B`);
console.log(`  1 entry point, ${attached.length} attached methods, all present in the artifact and backed by vendored source`);
