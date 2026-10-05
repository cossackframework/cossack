import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it('builds and gates the actual native Worker artifact before preparing the preview upload', async () => {
 const gate = process.env.COSSACK_PREVIEW_INSTALLED_ROOT;
 const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-preview-build-'));
 try {
  const root = path.join(parent, 'worker'); await fs.mkdir(root);
  const modules = gate ? path.join(gate, 'node_modules') : path.resolve('../..', 'node_modules');
  await fs.symlink(modules, path.join(root, 'node_modules'), 'junction');
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'preview-worker', type: 'module', cossack: { runtime: 'cloudflare' } }));
  await fs.writeFile(path.join(root, 'wrangler.json'), JSON.stringify({ name: 'preview-worker', main: 'index.js', compatibility_date: '2026-10-01', vars: { GREETING: 'production' }, previews: { vars: { GREETING: 'preview' } } }));
  await fs.writeFile(path.join(root, 'index.js'), 'export default { fetch(_request, env) { return new Response(env.GREETING); } };');
  await fs.writeFile(path.join(root, 'vite.config.js'), "import {defineConfig} from 'vite'; import {cloudflare} from '@cloudflare/vite-plugin'; export default defineConfig({plugins:[cloudflare()]});");
  const service = gate ? await import(path.join(gate, 'node_modules/cossack/src/preview-service.js')) : await import('../src/preview-service.js');
  let uploaded;
  const provider = {
   verify: async () => ({ status: 'verified' }), inspect: async () => ({ status: 'absent' }),
   deploy: async (filename, worker, name, tag) => {
    uploaded = JSON.parse(await fs.readFile(filename, 'utf8'));
    expect(uploaded.name).toBe(worker); expect(uploaded.account_id).toBe('a'.repeat(32));
    expect(uploaded.previews.vars).toEqual({ GREETING: 'preview' });
    const entry = path.resolve(path.dirname(filename), uploaded.main);
    expect(await fs.readFile(entry, 'utf8')).toContain('GREETING');
    return { status: 'deployed', preview: { id: 'preview-id', name, createdOn: '2026-10-06T00:00:00Z' }, deployment: { id: 'deployment-id', tag }, url: 'https://preview.test.workers.dev' };
   },
  };
  const result = await service.createPreview(root, { accountId: 'a'.repeat(32), name: 'test' }, { provider, fetch: async () => new Response('preview') });
  expect(result.status).toBe('deployed'); expect(uploaded).toBeDefined();
  expect(JSON.parse(await fs.readFile(path.join(root, '.wrangler/deploy/config.json'), 'utf8')).configPath).toBeTruthy();
 } finally { await fs.rm(parent, { recursive: true, force: true }); }
}, 120_000);
