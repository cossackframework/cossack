import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { decodeInspectionResult } from './inspection-result.js';

const failure = code => Object.assign(new Error(code), { code });
const MAX_WORKERS = 4;
const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lock', 'bun.lockb'];
const INSTALL_MARKERS = ['node_modules/.modules.yaml', 'node_modules/.package-lock.json', 'node_modules/.yarn-state.yml', 'node_modules/.yarn-integrity'];

async function stamp(file) {
  try {
    const stat = await fs.stat(file);
    return `${stat.size}:${stat.mtimeMs}:${stat.ino}`;
  } catch { return '-'; }
}

/**
 * Identify the dependency state a warm worker has loaded. Inspections read
 * project files (sources, catalogs, Wrangler config) fresh on every call, so
 * the only state a reused worker keeps is its module cache: the project's
 * Wrangler (imported from the project) and the installed CLI/framework
 * modules. The fingerprint covers what changes when those change: the
 * project manifest, the nearest lockfile and install markers, and the
 * resolved Wrangler manifest (real path, size, mtime, inode).
 */
export async function dependencyFingerprint(root) {
  const parts = [`package.json=${await stamp(path.join(root, 'package.json'))}`];
  for (let directory = root; ; directory = path.dirname(directory)) {
    const stamps = await Promise.all([...LOCKFILES, ...INSTALL_MARKERS].map(file => stamp(path.join(directory, file))));
    if (stamps.slice(0, LOCKFILES.length).some(value => value !== '-')) { parts.push(`${directory}=${stamps.join(',')}`); break; }
    if (path.dirname(directory) === directory) break;
  }
  // resolve.paths() lists candidate folders without touching Node's resolution cache.
  for (const directory of createRequire(path.join(root, 'package.json')).resolve.paths('wrangler') ?? []) {
    const manifest = path.join(directory, 'wrangler', 'package.json');
    const value = await stamp(manifest);
    if (value === '-') continue;
    parts.push(`wrangler=${await fs.realpath(manifest).catch(() => manifest)}:${value}`);
    break;
  }
  return parts.join('|');
}

/**
 * Runs inspections in a small pool of reusable workers, so repeated calls
 * keep Wrangler and the TypeScript compiler loaded. A call owns its worker
 * while it runs, so cancellation and deadlines terminate only that call's
 * synchronous compiler work. A worker returns to the pool only after a clean
 * result with an unchanged dependency fingerprint; a crash, cancellation,
 * timeout, invalid result or an exception inside the inspection retires it.
 * Idle workers are unreferenced, expire after `idleTimeout`, and are
 * terminated by `close()`.
 */
export class InspectionRunner {
  #workers = new Set();
  #idle = [];
  #active = 0;
  #closed = false;
  #key;
  constructor(root, {
    timeout = 30_000,
    idleTimeout = 5 * 60_000,
    workerUrl = new URL('./inspection-worker.js', import.meta.url),
    fingerprint = dependencyFingerprint,
  } = {}) {
    this.root = root;
    this.timeout = timeout;
    this.idleTimeout = idleTimeout;
    this.workerUrl = workerUrl;
    this.fingerprint = fingerprint;
  }
  /** Calls in progress. */
  get activeCount() { return this.#active; }
  /** Live workers, busy or idle. */
  get workerCount() { return this.#workers.size; }
  async close() {
    this.#closed = true;
    this.#idle = [];
    await Promise.all([...this.#workers].map(entry => this.#retire(entry)));
  }
  async run(input, signal) {
    if (this.#closed) throw failure('COSSACK_MCP_CLOSED');
    if (signal?.aborted) throw failure('COSSACK_MCP_CANCELED');
    if (this.#active >= MAX_WORKERS) throw failure('COSSACK_MCP_BUSY');
    this.#active++;
    try {
      let fingerprint;
      try { fingerprint = await this.fingerprint(this.root); } catch { fingerprint = `unknown:${Date.now()}:${Math.random()}`; }
      if (this.#closed) throw failure('COSSACK_MCP_CLOSED');
      if (signal?.aborted) throw failure('COSSACK_MCP_CANCELED');
      const key = `${this.workerUrl}\n${fingerprint}`;
      if (key !== this.#key) {
        this.#key = key;
        for (const entry of this.#idle.splice(0)) void this.#retire(entry);
      }
      const entry = this.#idle.pop() ?? this.#spawn(key);
      return await this.#call(entry, input, signal);
    } finally {
      this.#active--;
    }
  }
  #spawn(key) {
    const worker = new Worker(this.workerUrl, { workerData: { root: this.root }, stdout: true, stderr: true });
    // Wrangler/compiler output must never become MCP protocol output or expose values.
    worker.stdout.resume(); worker.stderr.resume();
    const entry = { worker, key, call: null, idleTimer: undefined };
    this.#workers.add(entry);
    worker.on('message', message => entry.call?.message(message));
    worker.on('error', () => entry.call?.fail('COSSACK_INSPECTION_FAILED'));
    worker.on('exit', () => {
      this.#forget(entry);
      entry.call?.fail(this.#closed ? 'COSSACK_MCP_CLOSED' : 'COSSACK_INSPECTION_FAILED');
    });
    return entry;
  }
  #call(entry, input, signal) {
    clearTimeout(entry.idleTimer);
    entry.worker.ref();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = async (error, value, reusable = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        entry.call = null;
        if (reusable && !this.#closed && entry.key === this.#key) this.#release(entry);
        else await this.#retire(entry);
        if (error) reject(error); else resolve(value);
      };
      const cancel = () => { void finish(failure('COSSACK_MCP_CANCELED')); };
      const timer = setTimeout(() => { void finish(failure('COSSACK_MCP_TIMEOUT')); }, this.timeout);
      signal?.addEventListener('abort', cancel, { once: true });
      entry.call = {
        // The worker serializes and measures the result (inspection-result.js),
        // so an oversized result never crosses into this thread.
        message: message => {
          const { error, value } = decodeInspectionResult(message);
          void finish(error ? failure(error) : null, value, !error && message.recycle !== true);
        },
        fail: code => { void finish(failure(code)); },
      };
      entry.worker.postMessage({ input });
      if (signal?.aborted) cancel();
    });
  }
  #release(entry) {
    entry.worker.unref();
    entry.idleTimer = setTimeout(() => { void this.#retire(entry); }, this.idleTimeout);
    entry.idleTimer.unref();
    this.#idle.push(entry);
  }
  #forget(entry) {
    clearTimeout(entry.idleTimer);
    this.#workers.delete(entry);
    const index = this.#idle.indexOf(entry);
    if (index !== -1) this.#idle.splice(index, 1);
  }
  async #retire(entry) {
    this.#forget(entry);
    await entry.worker.terminate();
  }
}
