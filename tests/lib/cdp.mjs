/*
 * A small Chrome DevTools Protocol client, so the web-layer tests need no
 * dependency and no visible window.
 *
 * It launches its own headless Chrome with a throwaway profile, talks to it over
 * the DevTools WebSocket, and gives one attached page plus three things a test
 * needs: `evaluate` (await a promise, return JSON), `cdp` (any protocol method,
 * page-scoped by default) and the raw event stream.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LAUNCH_TIMEOUT_MS = 45_000;

const CANDIDATE_BROWSERS = [
    process.env.FRYER_CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\BraveSoftware\\Brave-Browser-Nightly\\Application\\brave.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);

export function findBrowser() {
    const found = CANDIDATE_BROWSERS.find(path => existsSync(path));
    if (!found) throw new Error('no Chromium-family browser found; set FRYER_CHROME to one');
    return found;
}

class CdpConnection {
    constructor(socket) {
        this.socket = socket;
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = new Set();
        socket.addEventListener('message', event => this.onMessage(event.data));
        socket.addEventListener('close', () => {
            for (const { reject } of this.pending.values()) reject(new Error('devtools connection closed'));
            this.pending.clear();
        });
    }

    onMessage(raw) {
        const message = JSON.parse(typeof raw === 'string' ? raw : String(raw));
        if (message.id && this.pending.has(message.id)) {
            const { resolve, reject, method, sent } = this.pending.get(message.id);
            this.pending.delete(message.id);
            if (message.error) {
                reject(new Error(`cdp ${method} ${message.error.message} (${message.error.code}) ${JSON.stringify(sent).slice(0, 300)}`));
            }
            else resolve(message.result || {});
            return;
        }
        for (const listener of this.listeners) listener(message);
    }

    send(method, params = {}, sessionId) {
        const id = this.nextId++;
        const payload = { id, method, params };
        if (sessionId) payload.sessionId = sessionId;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject, method, sent: params });
            this.socket.send(JSON.stringify(payload));
        });
    }

    on(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }}

export async function launch({ headless = true, width = 1280, height = 900 } = {}) {
    const profileDir = mkdtempSync(join(tmpdir(), 'fryer-profile-'));
    const version = process.versions.node ? Number(process.versions.node.split('.')[0]) : 26;
    const args = [
        headless ? '--headless=new' : '--start-minimized',
        '--remote-debugging-port=0',
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-extensions',
        '--hide-scrollbars',
        '--mute-audio',
        `--window-size=${width},${height}`,
        'about:blank'
    ];

    const child = spawn(findBrowser(), args, { stdio: 'ignore' });
    const portFile = join(profileDir, 'DevToolsActivePort');

    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    let port = 0;
    while (Date.now() < deadline) {
        if (existsSync(portFile)) {
            /* Chrome writes this file while it is still open for writing. On
             * Windows the read can raise EBUSY or EPERM, and an early read can
             * see only the port line. Both mean "not ready", not "failed". */
            try {
                const [line, path] = readFileSync(portFile, 'utf8').split('\n');
                const candidate = Number(line);
                if (candidate && path && path.trim()) {
                    port = candidate;
                    break;
                }
            } catch (error) {
                if (!['EBUSY', 'EPERM', 'ENOENT'].includes(error.code)) throw error;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (!port) {
        child.kill();
        rmSync(profileDir, { recursive: true, force: true });
        throw new Error(`the browser did not open a devtools port in ${LAUNCH_TIMEOUT_MS / 1000}s`);
    }

    // The port file's second line is the browser endpoint path.
    const socketPath = readFileSync(portFile, 'utf8').split('\n')[1].trim();
    const socket = new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', () => reject(new Error('devtools websocket failed')), { once: true });
    });

    const connection = new CdpConnection(socket);

    return {
        connection,
        async openPage(url = 'about:blank') {
            const { targetId } = await connection.send('Target.createTarget', { url });
            const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
            const send = (method, params) => connection.send(method, params, sessionId);
            await send('Page.enable');
            await send('Runtime.enable');
            await send('Log.enable');

            const page = {
                targetId,
                sessionId,
                send,
                async evaluate(expression) {
                    const result = await send('Runtime.evaluate', {
                        expression,
                        awaitPromise: true,
                        returnByValue: true,
                        userGesture: true
                    });
                    if (result.exceptionDetails) {
                        const detail = result.exceptionDetails;
                        const text = (detail.exception && (detail.exception.description || detail.exception.value)) ||
                            detail.text || 'evaluation failed';
                        throw new Error(String(text).split('\n')[0]);
                    }
                    return result.result.value;
                },
                async evaluateJson(expression) {
                    const value = await page.evaluate(expression);
                    return typeof value === 'string' ? JSON.parse(value) : value;
                },
                async goto(target) {
                    const loaded = new Promise(resolve => {
                        const off = connection.on(message => {
                            if (message.sessionId !== sessionId) return;
                            if (message.method === 'Page.loadEventFired') { off(); resolve(); }
                        });
                    });
                    await send('Page.navigate', { url: target });
                    await loaded;
                },
                async waitFor(expression, timeoutMs = 15000) {
                    const until = Date.now() + timeoutMs;
                    while (Date.now() < until) {
                        if (await page.evaluate(expression)) return true;
                        await new Promise(resolve => setTimeout(resolve, 20));
                    }
                    throw new Error(`timed out waiting for: ${expression}`);
                },
                async close() {
                    await connection.send('Target.closeTarget', { targetId });
                }
            };
            // A target created with a URL is blank for a moment; anything run
            // before its first document lands is thrown away by the navigation.
            if (url && url !== 'about:blank') {
                await page.waitFor(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`);
            }
            return page;
        },
        async close() {
            try { socket.close(); } catch { /* already closed */ }
            child.kill();
            await new Promise(resolve => setTimeout(resolve, 200));
            rmSync(profileDir, { recursive: true, force: true });
        },
        get nodeMajor() { return version; }
    };
}
