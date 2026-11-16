/*
 * Serves the web app to the test browser, and builds any number of trees from
 * the same `app/` folder with a chosen `app.js`, so a baseline script and the
 * current one are measured through identical HTML and CSS.
 */
import { createServer } from 'node:http';
import { cpSync, existsSync, readFileSync, mkdirSync } from 'node:fs';import { extname, join, normalize, resolve } from 'node:path';

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8'
};

/** Copies `app/` into `${root}/${name}`, optionally swapping in another app.js. */
export function stageApp({ appDir, root, name, scriptPath }) {
    const target = join(root, name);
    mkdirSync(target, { recursive: true });
    cpSync(appDir, target, { recursive: true });

    if (scriptPath) cpSync(scriptPath, join(target, 'app.js'));
    return target;
}

/** Static server: every request path is a file under the given root. */
export async function serve(root) {
    const server = createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        const filePath = resolve(normalize(join(root, relative)));
        if (!filePath.startsWith(resolve(root))) {
            response.writeHead(403).end('forbidden');
            return;
        }
        if (!existsSync(filePath)) {
            response.writeHead(404).end('not found');
            return;
        }
        response.writeHead(200, {
            'content-type': TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
            'cache-control': 'no-store'
        });
        response.end(readFileSync(filePath));
    });

    await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
    const { port } = server.address();
    return {
        base: `http://127.0.0.1:${port}`,
        async close() {
            await new Promise(done => server.close(done));
        }
    };
}
