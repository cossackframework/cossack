import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.skipIf(!process.env.COSSACK_PREVIEW_INSTALLED_ROOT)('loads the new public CLI and CI recipe from changed tarballs alone', async () => {
 const gate = process.env.COSSACK_PREVIEW_INSTALLED_ROOT;
 const cli = path.join(gate, 'node_modules/cossack/bin/cossack.js');
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-preview-installed-'));
 const env = { ...process.env, COSSACK_DISABLE_UPDATE_CHECK: '1', CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ENV: '', CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: '' };
 const run = args => JSON.parse(execFileSync(process.execPath, [cli, ...args, '--json'], { cwd: root, encoding: 'utf8', env, timeout: 30_000 }));
 try {
  expect(run(['preview', '--help']).data.help).toContain('ignore-defaults');
  for (const adapter of ['cloudflare', 'node']) {
   const name = `app-${adapter}`; expect(run(['create', name, '--adapter', adapter, '--preset', 'minimal', '--yes']).ok).toBe(true);
   const filename = path.join(root, name, '.github/workflows/preview.yml');
   if (adapter === 'cloudflare') expect(await fs.readFile(filename, 'utf8')).toContain('cossack preview create');
   else await expect(fs.access(filename)).rejects.toThrow();
  }
  const app = path.join(root, 'app-cloudflare'); await fs.symlink(path.join(gate, 'node_modules'), path.join(app, 'node_modules'), 'junction');
  // The default app requires Worker secrets. Preserve that contract and prove
  // the new command does not silently upload an incomplete preview.
  const source = path.join(app, 'wrangler.jsonc'); const original = await fs.readFile(source, 'utf8');
  await fs.writeFile(source, original.replace(/"name":/, '"previews": {},\n  "name":'));
  let failure;
  try { execFileSync(process.execPath, [cli, 'preview', 'create', '--account', 'a'.repeat(32), '--name', 'test', '--dry-run', '--json'], { cwd: app, encoding: 'utf8', env, timeout: 30_000 }); }
  catch (caught) { failure = JSON.parse(caught.stdout); }
  expect(failure?.ok).toBe(false); expect(failure?.diagnostics[0].code).toBe('COSSACK_PREVIEW_BINDING_UNSUPPORTED');
  await expect(fs.access(path.join(app, '.cossack/preview.json'))).rejects.toThrow();
 } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 120_000);
