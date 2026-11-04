// @ts-check
/**
 * Local development on Node.js: when ROMEDB_URL is a loopback address, start `romedb serve`
 * for it and hand its token to the dev server, so no token is copied into `.env`. Beside it,
 * `romedb serve --directory` keeps the databases of a CMS network's added sites.
 * Plain JavaScript: Vite configs and dev scripts import it from node_modules.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** Ports {@link startLocalSites} tries, from the one it is given. */
const SITE_PORTS = 10;

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
    const stop = stopper(child);
    const token = await ready(child, service.origin, () => readToken(tokenFile), options.timeoutMs, stop);
    log(`started romedb serve for ${path.relative(root, file)} at ${service.origin}`);
    return { token, started: true, stop };
}

/**
 * Start `romedb serve --directory` on `port` for the databases of a CMS network's added sites,
 * unless a service already answers there, or on a later port when something else holds that one
 * (nothing remembers the port, so it can change between runs). Its data stays in `storage/romedb/sites` under `root`,
 * with the token in `storage/romedb/sites/romedb.token`.
 * @param {{ port: number, root?: string, binary?: string, timeoutMs?: number, log?: (message: string) => void }} options
 * @returns {Promise<{ url: string, token: string, started: boolean, stop(): Promise<void> } | undefined>} the organization
 *   URL and its token; undefined when the executable cannot serve a directory (before RomeDB 0.2.12) or another service answers there.
 */
export async function startLocalSites(options) {
    const root = options.root ?? process.cwd();
    const directory = path.join(root, 'storage/romedb/sites');
    const tokenFile = path.join(directory, 'romedb.token');
    const log = options.log ?? (message => console.log(`[romedb] ${message}`));
    // The organization ID stays in the directory's manifest across restarts.
    const organization = async () => {
        try {
            const manifest = JSON.parse(await fs.readFile(path.join(directory, 'romedb-directory.json'), 'utf8'));
            return typeof manifest?.organizationId === 'string' ? manifest.organizationId : '';
        } catch { return ''; }
    };
    /** @param {string} origin */
    const credentials = async origin => {
        const [token, id] = [await readToken(tokenFile), await organization()];
        return token && id ? { url: `${origin}/v1/organizations/${id}`, token } : undefined;
    };
    const first = `http://127.0.0.1:${options.port}`;
    if (await answers(first)) {
        const found = await credentials(first);
        if (!found) log(`another service answers at ${first}; set ROMEDB_SITES_URL and ROMEDB_SITES_TOKEN for added sites`);
        return found ? { ...found, started: false, stop: async () => {} } : undefined;
    }
    const binary = options.binary ?? process.env.ROMEDB_BIN ?? 'romedb';
    const help = spawnSync(binary, ['serve', '--help'], { encoding: 'utf8' });
    if (help.status !== 0 || !`${help.stdout}${help.stderr}`.includes('--directory')) {
        log('this romedb cannot serve a directory of databases (RomeDB 0.2.12 can), so the network cannot add sites');
        return undefined;
    }
    await fs.mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
    for (let attempt = 0; ; attempt++) {
        const origin = `http://127.0.0.1:${options.port + attempt}`;
        // Its startup lines name the organization URL and token file, which this reads itself.
        const child = spawn(binary, ['serve', '--directory', directory, '--create', '--port', String(options.port + attempt)], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
        let errors = '';
        child.stderr.on('data', data => {
            if (String(data).includes('AddrInUse')) errors += data;
            else process.stderr.write(data);
        });
        const closed = new Promise(resolve => child.once('close', resolve));
        const stop = stopper(child);
        try {
            const found = await ready(child, origin, () => credentials(origin), options.timeoutMs, stop);
            log(`started romedb serve --directory ${path.relative(root, directory)} for added sites at ${origin}`);
            return { ...found, started: true, stop };
        } catch (error) {
            await closed;
            if (!errors || attempt + 1 === SITE_PORTS) throw error;
        }
    }
}

/**
 * SIGTERM lets serve finish active requests and close its databases. Sent synchronously, so it
 * also works from a process 'exit' handler.
 * @param {import('node:child_process').ChildProcess} child
 * @returns {() => Promise<void>}
 */
function stopper(child) {
    process.once('exit', () => { if (child.exitCode === null) child.kill('SIGTERM'); });
    return () => new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve(undefined);
        child.once('exit', () => resolve(undefined));
        child.kill('SIGTERM');
    });
}

/**
 * Wait until the service answers and `read` finds its credentials; stop it after the deadline.
 * @template T
 * @param {import('node:child_process').ChildProcess} child
 * @param {string} origin
 * @param {() => Promise<T | undefined | ''>} read
 * @param {number | undefined} timeoutMs
 * @param {() => Promise<void>} stop
 * @returns {Promise<T>}
 */
async function ready(child, origin, read, timeoutMs, stop) {
    const deadline = Date.now() + (timeoutMs ?? 20_000);
    while (Date.now() < deadline && child.exitCode === null) {
        const found = await read();
        if (found && await answers(origin)) return found;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    await stop();
    throw new Error(`romedb serve did not answer at ${origin}.`);
}

/**
 * Vite plugin for `vite dev`: starts `romedb serve` for a loopback ROMEDB_URL (read from the
 * environment, `.dev.vars` or `.env`) and stops it with the dev server. The token lands in
 * `process.env.ROMEDB_TOKEN`. Unless ROMEDB_SITES_URL is set, it also starts
 * `romedb serve --directory` on the next free port for a CMS network's added sites, and sets
 * ROMEDB_SITES_URL and ROMEDB_SITES_TOKEN. Workers apps pass these on with {@link romedbDevVars}.
 * List it before the Cloudflare plugin.
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
            if (!service) return;
            process.env.ROMEDB_TOKEN = service.token;
            if (process.env.ROMEDB_SITES_URL || await readVar(root, 'ROMEDB_SITES_URL')) return;
            const sitesKey = `${key}\nsites`;
            if (!running.has(sitesKey)) {
                const starting = startLocalSites({ port: (localService(url)?.port ?? 4321) + 1, root });
                running.set(sitesKey, starting);
                starting.catch(() => running.delete(sitesKey));
            }
            const sites = await running.get(sitesKey);
            if (sites && 'url' in sites) {
                process.env.ROMEDB_SITES_URL = sites.url;
                process.env.ROMEDB_SITES_TOKEN = sites.token;
            }
        },
    };
}

/** @type {Map<string, ReturnType<typeof startLocalRomeDB> | ReturnType<typeof startLocalSites>>} */
const running = new Map();

/**
 * Cloudflare plugin `config` customizer: what {@link romedbDev} read (the token, and the added
 * sites' organization URL and token), as local variables.
 * @returns {{ vars?: { ROMEDB_TOKEN?: string, ROMEDB_SITES_URL?: string, ROMEDB_SITES_TOKEN?: string } }}
 */
export function romedbDevVars() {
    const vars = Object.fromEntries(['ROMEDB_TOKEN', 'ROMEDB_SITES_URL', 'ROMEDB_SITES_TOKEN'].flatMap(name => process.env[name] ? [[name, process.env[name]]] : []));
    return Object.keys(vars).length ? { vars } : {};
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
