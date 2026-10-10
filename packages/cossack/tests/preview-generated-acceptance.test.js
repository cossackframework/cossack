import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { scaffoldLinkedApp } from './fixtures/linked-app.js';
const execute = promisify(execFile);

it('builds and smokes a generated secret-requiring application without leaking preview secrets', async () => {
 const gate = process.env.COSSACK_PREVIEW_INSTALLED_ROOT;
 const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-preview-generated-'));
 const root = path.join(parent, 'app'); let harness;
 try {
  if (gate) {
   await execute(process.execPath, [path.join(gate, 'node_modules/cossack/bin/cossack.js'), 'create', 'app', '--adapter', 'cloudflare', '--preset', 'minimal', '--yes', '--json'], { cwd: parent, timeout: 30000 });
   await fs.symlink(path.join(gate, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  } else await scaffoldLinkedApp(parent, { adapter: 'cloudflare', packages: ['framework', 'core', 'renderer', 'scaffold'] });
  const source = path.join(root, 'wrangler.jsonc');
  const original = await fs.readFile(source, 'utf8');
  await fs.writeFile(source, original.replace(/"name":/, '"previews": {"vars": {"APP_URL": "https://preview.example.test", "APP_LOCALE": "en"}},\n  "name":').replace('https://example.com', 'https://production.example.test'));
  const secret = 'dummy-generated-staging-secret-32bytes'; const secretsFile = path.join(parent, 'secrets.json');
  await fs.writeFile(secretsFile, JSON.stringify({ APP_SECRET: secret }), { mode: 0o600 });
  const service = gate ? await import(path.join(gate, 'node_modules/cossack/src/preview-service.js')) : await import('../src/preview-service.js');
  const require = createRequire(path.join(root, 'package.json')); let uploadedPath;
  const provider = {
   verify: async () => ({ status: 'verified' }), inspect: async () => ({ status: 'absent' }),
   deploy: async (filename, _worker, name, tag) => {
    uploadedPath = filename; const config = JSON.parse(await fs.readFile(filename, 'utf8'));
    expect(config.secrets.required).toContain('APP_SECRET');
    expect(config.previews.unsafe.bindings).toEqual([{ name: 'APP_SECRET', type: 'secret_text', text: secret }]);
    expect(config.previews.durable_objects.bindings).toContainEqual({ name: 'COSSACK_SSE', class_name: 'SseDurableObject' });
    harness = require('wrangler').createTestHarness({ root, workers: [{ configPath: path.join(root, 'dist/ssr/wrangler.json'), secrets: { APP_SECRET: secret } }] });
    await harness.listen();
    return { status: 'deployed', preview: { id: 'generated-preview', name, createdOn: '2026-10-06T00:00:00Z' }, deployment: { id: 'generated-deployment', tag }, url: 'https://preview.fixture.workers.dev' };
   },
  };
  const journal = await service.createPreview(root, { accountId: 'a'.repeat(32), name: 'generated', secretsFile }, { provider, fetch: async target => harness.fetch(target.href) });
  expect(journal.smoke.status).toBe(200);
  expect(JSON.stringify(journal)).not.toContain(secret);
  expect(await fs.readFile(path.join(root, '.cossack/preview.json'), 'utf8')).not.toContain(secret);
  await expect(fs.access(uploadedPath)).rejects.toThrow();
  async function inspectFiles(directory) { for (const entry of await fs.readdir(directory, { withFileTypes: true })) { const filename = path.join(directory, entry.name); if (entry.isDirectory()) await inspectFiles(filename); else expect((await fs.readFile(filename)).includes(Buffer.from(secret))).toBe(false); } }
  await inspectFiles(path.join(root, 'dist/client'));
 } finally { await harness?.close(); await fs.rm(parent, { recursive: true, force: true }); }
}, 180000);
