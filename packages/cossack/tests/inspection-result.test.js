import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { InspectionRunner } from '../src/mcp/inspection-runner.js';
import { decodeInspectionResult, encodeInspectionResult } from '../src/mcp/inspection-result.js';

const cleanup = [];
afterEach(async () => {
  for (const item of cleanup.splice(0)) await item();
});

describe('MCP inspection result transfer', () => {
  it('measures in the worker and never posts an oversized payload', () => {
    const message = encodeInspectionResult({ data: 'x'.repeat(64) }, 32);
    expect(message).toEqual({ kind: 'too-large' });
    expect(decodeInspectionResult(message, 32)).toEqual({ error: 'COSSACK_MCP_RESULT_TOO_LARGE' });
  });

  it('round-trips results within the limit as a string', () => {
    const value = { ok: true, data: { scope: 'routes', name: 'café' }, diagnostics: [] };
    const message = encodeInspectionResult(value);
    expect(typeof message.json).toBe('string');
    expect(decodeInspectionResult(message)).toEqual({ value });
  });

  it('counts UTF-8 bytes, not string length', () => {
    expect(encodeInspectionResult('é'.repeat(20), 30)).toEqual({ kind: 'too-large' });
  });

  it('rejects messages outside the protocol', () => {
    expect(decodeInspectionResult('x'.repeat(10))).toEqual({ error: 'COSSACK_INSPECTION_FAILED' });
    expect(decodeInspectionResult({ kind: 'result', json: '{' })).toEqual({ error: 'COSSACK_INSPECTION_FAILED' });
  });

  it('the runner rejects a raw oversized structured-clone message instead of measuring it after transfer', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-mcp-result-'));
    cleanup.push(() => fs.rm(directory, { recursive: true, force: true }));
    const worker = path.join(directory, 'raw.mjs');
    await fs.writeFile(worker, "import {parentPort} from 'node:worker_threads'; parentPort.postMessage({ ok: true, data: 'x'.repeat(16) });");
    const runner = new InspectionRunner(directory, { workerUrl: pathToFileURL(worker) });
    cleanup.push(() => runner.close());
    await expect(runner.run({})).rejects.toMatchObject({ code: 'COSSACK_INSPECTION_FAILED' });
  });
});
