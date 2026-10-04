import { afterEach, expect, it } from 'vitest';
import { build, createServer } from 'vite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
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

async function buildFixture(runtime: Exclude<RuntimeName, 'unknown'>, transport: 'http' | 'sse', bindings: string[] | null = [], requires: CapabilityRequirement = { transports: [transport] }, pageSource?: string, environment?: string, pagePath = 'src/pages/chat/index.ts') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-capability-build-'));
  roots.push(root);
  if (bindings === null) {
    const require = createRequire(import.meta.url);
    await fs.writeFile(path.join(root, 'package.json'), '{}');
    await fs.mkdir(path.join(root, 'node_modules'));
    await fs.symlink(path.dirname(require.resolve('wrangler/package.json')), path.join(root, 'node_modules/wrangler'), 'junction');
    await fs.writeFile(path.join(root, 'wrangler.jsonc'), JSON.stringify({ name: 'capability-test', compatibility_date: '2026-01-01',
      durable_objects: { bindings: [{ name: 'COSSACK_SSE', class_name: 'SseDurableObject' }] },
      env: { staging: { durable_objects: { bindings: [] } } },
    }));
  }
  await fs.writeFile(path.join(root, 'entry.js'), 'export const portable = true;');
  if (pageSource) {
    await fs.mkdir(path.dirname(path.join(root, pagePath)), { recursive: true });
    await fs.writeFile(path.join(root, pagePath), pageSource);
  }
  // An unselected optional module must not change the portable build's result.
  await fs.writeFile(path.join(root, 'unused-cloudflare.js'), "import { DurableObject } from 'cloudflare:workers'; export class Optional extends DurableObject {}");
  return build({ root, configFile: false, logLevel: 'silent', plugins: [cossackPages({ capabilities: {
    runtime, bindings: bindings ?? undefined, environment, requirements: [{ feature: 'page transport', source: { file: path.join(root, 'src/pages/chat/index.ts'), line: 3 }, requires }],
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

it('discovers a Desktop-incompatible page without repeating its transport in config', async () => {
  await expect(buildFixture('desktop', 'http', [], {},
    "@Page({ transport: 'sse' }) export default class Chat {}"))
    .rejects.toMatchObject({ message: expect.stringMatching(/chat\/index.ts:1: page transport requires transports on desktop/) });
});
it('uses the shared aliased decorator parser for discovered Cloudflare requirements', async () => {
  const source = "import { Page as Route } from '@cossackframework/core'; @Route({ transport: 'sse' }) export default class Chat {}";
  await expect(buildFixture('cloudflare', 'http', [], {}, source))
    .rejects.toMatchObject({ message: expect.stringContaining('COSSACK_SSE') });
  await expect(buildFixture('cloudflare', 'http', ['COSSACK_SSE'], {}, source)).resolves.toBeDefined();
});
it('fails unknown discovered options rather than defaulting them to HTTP', async () => {
  await expect(buildFixture('desktop', 'http', [], {}, '@Page(config) export default class Chat {}'))
    .rejects.toMatchObject({ message: expect.stringContaining('page transport requirements are unknown') });
});
it('does not instantiate a discovered page to determine its requirements', async () => {
  await expect(buildFixture('desktop', 'http', [], {},
    '@Page() export default class Chat { constructor() { throw new Error("must not execute"); } }')).resolves.toBeDefined();
});

it('discovers bindings through the project Wrangler parser and honors environment isolation', async () => {
  const page = "@Page({ transport: 'sse' }) export default class Chat {}";
  await expect(buildFixture('cloudflare', 'http', null, {}, page)).resolves.toBeDefined();
  await expect(buildFixture('cloudflare', 'http', null, {}, page, 'staging'))
    .rejects.toMatchObject({ message: expect.stringContaining('COSSACK_SSE') });
  await expect(buildFixture('cloudflare', 'http', null, {}, page, 'missing'))
    .rejects.toMatchObject({ message: expect.stringContaining('COSSACK_BUILD_ENVIRONMENT_UNKNOWN') });
});

it('accepts discovered named HTTP handler modules without component decorators', async () => {
  await expect(buildFixture('desktop', 'http', [], {},
    'export const POST = factory(); export async function GET(c) { return c.json({ ok: true }); }', undefined, 'src/pages/api/chat.ts')).resolves.toBeDefined();
});

it.each(['node', 'deno'] as const)('rejects durable state before bundling on %s but allows process-local pages', async runtime => {
  const page = (stateful: string) => `@Page({ transport: 'durable-object', stateful: ${stateful} }) export default class Chat {}`;
  await expect(buildFixture(runtime, 'http', [], {}, page('true')))
    .rejects.toMatchObject({ message: expect.stringMatching(/chat\/index.ts:1: page transport requires durableState/) });
  await expect(buildFixture(runtime, 'http', [], {}, page('false'))).resolves.toBeDefined();
  await expect(buildFixture(runtime, 'http', [], {}, page('isDurable()')))
    .rejects.toMatchObject({ message: expect.stringContaining('requirements are unknown') });
});
it('allows durable Cloudflare pages only with their binding', async () => {
  const page = "@Page({ transport: 'durable-object', stateful: true }) export default class Chat {}";
  await expect(buildFixture('cloudflare', 'http', [], {}, page)).rejects.toThrow('COSSACK_OBJECT');
  await expect(buildFixture('cloudflare', 'http', ['COSSACK_OBJECT'], {}, page)).resolves.toBeDefined();
});

it('checks native database bindings before modules are bundled', async () => {
  await expect(buildFixture('cloudflare', 'http', [], { cloudflareBindings: ['DB'] }))
    .rejects.toThrow('missing binding(s) DB');
  await expect(buildFixture('cloudflare', 'http', ['DB'], { cloudflareBindings: ['DB'] })).resolves.toBeDefined();
  await expect(buildFixture('desktop', 'http', ['DB'], { cloudflareBindings: ['DB'] }))
    .rejects.toThrow('cloudflareBindings on desktop');
});

it('keeps syntax-broken development source repairable while builds still reject unknown requirements', async () => {
  const broken='@Page({ transport: \'http\' }) export default class Chat { invalid syntax';
  await expect(buildFixture('desktop','http',[],{},broken)).rejects.toThrow('requirements are unknown');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-capability-dev-'));
  roots.push(root);
  const file=path.join(root,'src/pages/index.ts');
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,broken);
  const server=await createServer({root,configFile:false,logLevel:'silent',server:{middlewareMode:true},plugins:[cossackPages({capabilities:{runtime:'desktop'}})]});
  try {
    await expect(server.transformRequest('/src/pages/index.ts')).rejects.toThrow();
    for (const [source, message] of [
      ["@Page({transport:'sse'}) export default class Chat {}", 'requires transports on desktop'],
      ['@Page(config) export default class Chat {}', 'requirements are unknown'],
    ]) {
      await fs.writeFile(file, source);
      server.environments.client.moduleGraph.invalidateAll();
      await expect(server.transformRequest('/src/pages/index.ts')).rejects.toThrow(message);
    }
    await fs.writeFile(file,"@Page({transport:'http'}) export default class Chat {}");
    server.environments.client.moduleGraph.invalidateAll();
    expect((await server.transformRequest('/src/pages/index.ts'))?.code).toContain('class Chat');
  } finally {await server.close();}
});
it('still rejects dynamic transport options when starting development', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-capability-dev-'));
  roots.push(root);
  await fs.mkdir(path.join(root,'src/pages'),{recursive:true});
  await fs.writeFile(path.join(root,'src/pages/index.ts'),'@Page(config) export default class Chat {}');
  let started: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    await expect(createServer({root,configFile:false,logLevel:'silent',server:{middlewareMode:true},plugins:[
      {name:'capture-failed-server',configureServer(server){started=server;}},
      cossackPages({capabilities:{runtime:'desktop'}}),
    ]})).rejects.toThrow('requirements are unknown');
  } finally {await started?.close();}
});
