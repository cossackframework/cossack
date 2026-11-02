// @ts-check
/**
 * Local development on Node.js: when ROMEDB_URL is a loopback address, start `romedb serve`
 * for it and hand its token to the dev server, so no token is copied into `.env`.
 * Plain JavaScript: Vite configs and dev scripts import it from node_modules.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The local single-database service a ROMEDB_URL names: a loopback `http://` URL with no path
 * or `/v1/database`. Files, remote URLs and organization URLs return undefined.
 * @param {string | undefined} url
 * @returns {{ origin: string, port: number } | undefined}
 */
export function localService(url) {
    if (!url || !/^http:\/\//i.test(url)) return undefined;
    const parsed = new URL(url);
    if (!LOOPBACK.has(parsed.hostname)) return undefined;
    const pathname = parsed.pathname.replace(/\/$/, '');
    if (pathname && pathname !== '/v1/database') return undefined;
    return { origin: parsed.origin, port: Number(parsed.port || 80) };
}

/**
 * Start `romedb serve` for a loopback ROMEDB_URL unless a service already answers there. Its
 * data stays in `storage/romedb/app.romedb` under `root`, created on the first start, and the
 * token in `storage/romedb/token`.
 * @param {{ url: string | undefined, root?: string, binary?: string, timeoutMs?: number, log?: (message: string) => void }} options
 * @returns {Promise<{ token: string, started: boolean, stop(): Promise<void> } | undefined>} undefined when the URL is
 *   not a local service, or when another service answers there (its token is ROMEDB_TOKEN's).
 */
export async function startLocalRomeDB(options) {
    const service = localService(options.url);
    if (!service) return undefined;
    const root = options.root ?? process.cwd();
    const storage = path.join(root, 'storage/romedb');
    const tokenFile = path.join(storage, 'token');
    const log = options.log ?? (message => console.log(`[romedb] ${message}`));
    if (await answers(service.origin)) {
        // A service this app started earlier left its token file; any other uses ROMEDB_TOKEN.
        const token = await readToken(tokenFile);
        log(`using the service at ${service.origin}`);
        return token ? { token, started: false, stop: async () => {} } : undefined;
    }
    const binary = options.binary ?? process.env.ROMEDB_BIN ?? 'romedb';
    if (spawnSync(binary, ['--version'], { stdio: 'ignore' }).status !== 0) {
        throw new Error(`ROMEDB_URL is ${options.url}, but no romedb executable was found. Install the RomeDB CLI, set ROMEDB_BIN, or set ROMEDB_URL to a file path such as storage/romedb/app.romedb.`);
    }
    await fs.mkdir(storage, { recursive: true, mode: 0o700 });
    const file = path.join(storage, 'app.romedb');
    const create = await fs.access(file).then(() => false, () => true);
    const child = spawn(binary, ['serve', file, ...(create ? ['--create'] : []), '--port', String(service.port), '--token-file', tokenFile], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
    // SIGTERM lets serve finish active requests and close the database. Sent synchronously,
    // so it also works from a process 'exit' handler.
    const stop = () => new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve(undefined);
        child.once('exit', () => resolve(undefined));
        child.kill('SIGTERM');
    });
    process.once('exit', () => { if (child.exitCode === null) child.kill('SIGTERM'); });
    const deadline = Date.now() + (options.timeoutMs ?? 20_000);
    while (Date.now() < deadline && child.exitCode === null) {
        const token = await readToken(tokenFile);
        if (token && await answers(service.origin)) {
            log(`started romedb serve for ${path.relative(root, file)} at ${service.origin}`);
            return { token, started: true, stop };
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    await stop();
    throw new Error(`romedb serve did not answer at ${service.origin}.`);
}

/**
 * Vite plugin for `vite dev`: starts `romedb serve` for a loopback ROMEDB_URL (read from the
 * environment, `.dev.vars` or `.env`) and stops it with the dev server. The token lands in
 * `process.env.ROMEDB_TOKEN`; Workers apps pass it on with {@link romedbDevVars}. List it before
 * the Cloudflare plugin.
 * @param {{ url?: string, root?: string }} [options]
 * @returns {import('vite').Plugin}
 */
export function romedbDev(options = {}) {
    return {
        name: 'cossack:romedb-dev',
        apply: 'serve',
        async config(config) {
            const root = path.resolve(options.root ?? config.root ?? process.cwd());
            const url = options.url ?? process.env.ROMEDB_URL ?? await readVar(root, 'ROMEDB_URL');
            if (!localService(url)) return;
            // One service per process: a config reload builds the new server before it closes
            // the old one, so the service lives until the dev process exits.
            const key = `${root}\n${url}`;
            if (!running.has(key)) {
                const starting = startLocalRomeDB({ url, root });
                running.set(key, starting);
                starting.catch(() => running.delete(key));
            }
            const service = await running.get(key);
            if (service) process.env.ROMEDB_TOKEN = service.token;
        },
    };
}

/** @type {Map<string, ReturnType<typeof startLocalRomeDB>>} */
const running = new Map();

/**
 * Cloudflare plugin `config` customizer: the token {@link romedbDev} read, as a local variable.
 * @returns {{ vars?: { ROMEDB_TOKEN: string } }}
 */
export function romedbDevVars() {
    return process.env.ROMEDB_TOKEN ? { vars: { ROMEDB_TOKEN: process.env.ROMEDB_TOKEN } } : {};
}

/** @param {string} origin */
async function answers(origin) {
    try {
        const response = await fetch(`${origin}/v1/database`, { signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        return true;
    } catch { return false; }
}

/** @param {string} file */
async function readToken(file) {
    return (await fs.readFile(file, 'utf8').catch(() => '')).trim();
}

/**
 * @param {string} root
 * @param {string} name
 */
async function readVar(root, name) {
    for (const file of ['.dev.vars', '.env']) {
        const text = await fs.readFile(path.join(root, file), 'utf8').catch(() => '');
        const line = text.split('\n').find(entry => entry.startsWith(`${name}=`));
        if (line !== undefined) return line.slice(name.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    return undefined;
}
