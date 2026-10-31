import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

export interface RomeDBTestService {
    readonly url: string;
    readonly token: string;
    readonly version: string;
    stop(): Promise<void>;
}

/**
 * Locate a RomeDB executable: `COSSACK_TEST_ROMEDB_BIN`, then `romedb` on PATH.
 * Returns undefined when neither exists, so live suites can skip.
 */
export function findRomeDBBinary(): string | undefined {
    const configured = process.env.COSSACK_TEST_ROMEDB_BIN;
    if (configured) return configured;
    const probe = spawnSync('romedb', ['--version'], { encoding: 'utf8' });
    return probe.status === 0 ? 'romedb' : undefined;
}

/**
 * True when live RomeDB suites should run: an executable exists, or
 * `COSSACK_TEST_REQUIRE_LIVE=1` demands them (they then fail instead of skipping).
 */
export function liveRomeDBTests(): boolean {
    return findRomeDBBinary() !== undefined || process.env.COSSACK_TEST_REQUIRE_LIVE === '1';
}

/** Start `romedb serve` on a free loopback port with a new database in a temporary directory. */
export async function startRomeDBService(options: { binary?: string; timeoutMs?: number } = {}): Promise<RomeDBTestService> {
    const binary = options.binary ?? findRomeDBBinary();
    if (!binary) throw new Error('No RomeDB executable: set COSSACK_TEST_ROMEDB_BIN or put romedb on PATH.');
    const version = spawnSync(binary, ['--version'], { encoding: 'utf8' }).stdout.trim().replace(/^romedb\s+/, '');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'cossack-romedb-'));
    const port = await freePort();
    const tokenFile = path.join(directory, 'token');
    const child = spawn(binary, ['serve', path.join(directory, 'test.romedb'), '--create', '--port', String(port), '--token-file', tokenFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.stderr?.on('data', chunk => { output += chunk; });
    const url = `http://127.0.0.1:${port}/v1/database`;
    const deadline = Date.now() + (options.timeoutMs ?? 10_000);
    let token = '';
    while (Date.now() < deadline) {
        if (child.exitCode !== null) break;
        token = (await readFile(tokenFile, 'utf8').catch(() => '')).trim();
        if (token && await reachable(url, token)) {
            return { url, token, version, stop: () => stop(child, directory) };
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    await stop(child, directory);
    throw new Error(`RomeDB service did not start: ${output.slice(0, 2000)}`);
}

async function reachable(url: string, token: string): Promise<boolean> {
    try {
        const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
        await response.body?.cancel();
        return response.ok;
    } catch { return false; }
}

async function stop(child: ChildProcess, directory: string): Promise<void> {
    if (child.exitCode === null) {
        const exited = new Promise(resolve => child.once('exit', resolve));
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
        await exited;
        clearTimeout(timer);
    }
    await rm(directory, { recursive: true, force: true });
}

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(() => typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port')));
        });
    });
}
