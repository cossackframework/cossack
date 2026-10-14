import { Worker } from 'node:worker_threads';
import { decodeInspectionResult } from './inspection-result.js';

const failure = code => Object.assign(new Error(code), { code });

/** Each call owns a worker so cancellation also stops synchronous compiler work. */
export class InspectionRunner {
  #workers = new Set();
  #closed = false;
  constructor(root, { timeout = 30_000, workerUrl = new URL('./inspection-worker.js', import.meta.url) } = {}) {
    this.root = root;
    this.timeout = timeout;
    this.workerUrl = workerUrl;
  }
  get activeCount() { return this.#workers.size; }
  async close() {
    this.#closed = true;
    await Promise.all([...this.#workers].map(worker => worker.terminate()));
  }
  run(input, signal) {
    if (this.#closed) return Promise.reject(failure('COSSACK_MCP_CLOSED'));
    if (signal?.aborted) return Promise.reject(failure('COSSACK_MCP_CANCELED'));
    if (this.#workers.size >= 4) return Promise.reject(failure('COSSACK_MCP_BUSY'));
    const worker = new Worker(this.workerUrl, { workerData: { root: this.root, input }, stdout: true, stderr: true });
    this.#workers.add(worker);
    // Wrangler/compiler output must never become MCP protocol output or expose values.
    worker.stdout.resume(); worker.stderr.resume();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = async (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        await worker.terminate();
        this.#workers.delete(worker);
        if (error) reject(error); else resolve(value);
      };
      const cancel = () => { void finish(failure('COSSACK_MCP_CANCELED')); };
      const timer = setTimeout(() => { void finish(failure('COSSACK_MCP_TIMEOUT')); }, this.timeout);
      signal?.addEventListener('abort', cancel, { once: true });
      // The worker serializes and measures the result (inspection-result.js),
      // so an oversized result never crosses into this thread.
      worker.once('message', message => {
        const { error, value } = decodeInspectionResult(message);
        if (error) void finish(failure(error));
        else void finish(null, value);
      });
      worker.once('error', () => { void finish(failure('COSSACK_INSPECTION_FAILED')); });
      worker.once('exit', () => { void finish(failure(this.#closed ? 'COSSACK_MCP_CLOSED' : 'COSSACK_INSPECTION_FAILED')); });
      if (signal?.aborted) cancel();
    });
  }
}
