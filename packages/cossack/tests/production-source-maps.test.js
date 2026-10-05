import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createApp } from '@cossackframework/scaffold';
import { writeProductionSourceMapFixture, verifyProductionSourceMap, verifyWranglerSourceMapArtifacts } from './fixtures/production-source-maps.js';

const execute = promisify(execFile);
const repository = path.resolve(import.meta.dirname, '../../..');

it.each([{ features: [] }, { features: ['workflows'] }])('resolves a real workerd production fault and prepared upload map with features $features', async ({ features }) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-production-source-maps-'));
  const gate = process.env.COSSACK_SOURCE_MAPS_INSTALLED_ROOT;
  let harness;
  try {
    let root;
    if (gate) {
      root = path.join(parent, 'app');
      await execute(process.execPath, [path.join(gate, 'node_modules/cossack/bin/cossack.js'), 'create', 'app', '--adapter', 'cloudflare', '--preset', 'minimal', ...(features.length ? ['--features', features.join(',')] : []), '--yes', '--json'], {
        cwd: parent, timeout: 30000, env: { ...process.env, COSSACK_DISABLE_UPDATE_CHECK: '1' },
      });
      await fs.symlink(path.join(gate, 'node_modules'), path.join(root, 'node_modules'), 'junction');
    } else {
      ({ projectDir: root } = await createApp('app', { cwd: parent, adapter: 'cloudflare', preset: 'minimal', features, interactive: false }));
      const modules = path.join(root, 'node_modules');
      await fs.mkdir(modules);
      for (const name of await fs.readdir(path.join(repository, 'node_modules'))) {
        if (name.startsWith('.') || name === '@cossackframework') continue;
        await fs.symlink(path.join(repository, 'node_modules', name), path.join(modules, name), 'junction');
      }
      await fs.mkdir(path.join(modules, '@cossackframework'));
      for (const name of ['framework', 'core', 'renderer', 'scaffold']) {
        await fs.symlink(path.join(repository, 'packages', name), path.join(modules, '@cossackframework', name), 'junction');
      }
    }
    const fixture = await writeProductionSourceMapFixture(root);
    const require = createRequire(path.join(root, 'package.json'));
    const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
    await execute(process.execPath, [vite, 'build'], { cwd: root, timeout: 120000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NODE_ENV: 'production', VITEST: '', CLOUDFLARE_ENV: '', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' } });
    const { createTestHarness } = require('wrangler');
    harness = createTestHarness({ root, workers: [{ configPath: path.join(root, 'dist/ssr/wrangler.json') }] });
    const { url } = await harness.listen();
    const resolved = await verifyProductionSourceMap(root, new URL(url).origin, fixture);
    expect(resolved.file).toContain(fixture.relative);
    expect(resolved.line).toBe(2);
    const wrangler = path.join(path.dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js');
    const outdir = path.join(parent, 'wrangler-dry-run');
    const outfile = path.join(parent, 'worker-upload.bundle');
    await execute(process.execPath, [wrangler, 'deploy', '--dry-run', '--config', 'dist/ssr/wrangler.json', '--outdir', outdir, '--outfile', outfile], {
      cwd: root, timeout: 60000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false', COSSACK_DISABLE_UPDATE_CHECK: '1' },
    });
    await verifyWranglerSourceMapArtifacts(root, outfile, fixture);
  } finally {
    try { await harness?.close(); }
    finally { await fs.rm(parent, { recursive: true, force: true }); }
  }
}, 180000);
