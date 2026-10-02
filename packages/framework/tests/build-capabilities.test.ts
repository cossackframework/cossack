import { afterEach, expect, it } from 'vitest';
import { build } from 'vite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cossackPages } from '@cossackframework/framework/vite-plugin';
import { checkCapabilityRequirements, type RuntimeName, type CapabilityRequirement } from '@cossackframework/framework/runtime-capabilities';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

it('returns all selected feature failures with their source and no binding values', () => {
  const source = { file: 'src/pages/chat/index.ts', line: 4, column: 2 };
  expect(checkCapabilityRequirements('cloudflare', [
    { feature: 'chat', source, requires: { transports: ['sse', 'durable-object'] } },
    { feature: 'local files', source, requires: { filesystem: true } },
    { feature: 'unused filesystem', source, requires: { filesystem: false } },
  ])).toEqual([
    expect.objectContaining({ code: 'COSSACK_CAPABILITY_BINDING_MISSING', feature: 'chat', source,
      missingBindings: ['COSSACK_SSE', 'COSSACK_OBJECT'] }),
    expect.objectContaining({ code: 'COSSACK_CAPABILITY_UNSUPPORTED', feature: 'local files', source, missingBindings: [] }),
  ]);
  expect(checkCapabilityRequirements('cloudflare', [{ feature: 'chat', source, requires: { transports: ['sse'] } }], ['COSSACK_SSE'])).toEqual([]);
});

async function buildFixture(runtime: Exclude<RuntimeName, 'unknown'>, transport: 'http' | 'sse', bindings: string[] = [], requires: CapabilityRequirement = { transports: [transport] }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-capability-build-'));
  roots.push(root);
  await fs.writeFile(path.join(root, 'entry.js'), 'export const portable = true;');
  // An unselected optional module must not change the portable build's result.
  await fs.writeFile(path.join(root, 'unused-cloudflare.js'), "import { DurableObject } from 'cloudflare:workers'; export class Optional extends DurableObject {}");
  return build({ root, configFile: false, logLevel: 'silent', plugins: [cossackPages({ capabilities: {
    runtime, bindings, requirements: [{ feature: 'page transport', source: { file: path.join(root, 'src/pages/chat/index.ts'), line: 3 }, requires }],
  } })], build: { write: false, minify: false, lib: { entry: path.join(root, 'entry.js'), formats: ['es'] } } });
}

it('fails Desktop SSE before emitting a bundle and identifies the selected feature and source', async () => {
  await expect(buildFixture('desktop', 'sse')).rejects.toMatchObject({
    message: expect.stringMatching(/src\/pages\/chat\/index.ts:3: page transport requires transports on desktop/),
  });
});
it('fails Cloudflare SSE without its binding', async () => {
  await expect(buildFixture('cloudflare', 'sse')).rejects.toMatchObject({ message: expect.stringContaining('COSSACK_SSE') });
});
it.each(['cloudflare', 'node', 'deno', 'desktop'] as const)('builds portable HTTP for %s without pulling optional Cloudflare imports', async runtime => {
  const result = await buildFixture(runtime, 'http');
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(output => 'output' in output ? output.output : []);
  expect(outputs.some(output => output.type === 'chunk')).toBe(true);
  for (const output of outputs) if (output.type === 'chunk') expect(output.code).not.toContain('cloudflare:workers');
});
it('builds selected Cloudflare SSE with its declared binding', async () => {
  await expect(buildFixture('cloudflare', 'sse', ['COSSACK_SSE'])).resolves.toBeDefined();
});

it.each(['node', 'deno'] as const)('rejects scheduled dispatch without an integration on %s', async runtime => {
  const source = { file: 'src/schedules/report.ts', line: 2 };
  expect(checkCapabilityRequirements(runtime, [{ feature: 'daily report', source, requires: { scheduledHandlers: true } }]))
    .toEqual([expect.objectContaining({ code: 'COSSACK_CAPABILITY_ADAPTER_REQUIRED', feature: 'daily report', source })]);
  await expect(buildFixture(runtime, 'http', [], { scheduledHandlers: true }))
    .rejects.toMatchObject({ message: expect.stringContaining('requires an adapter integration') });
});
