import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { it, expect } from 'vitest';
import { scaffoldLinkedApp } from './fixtures/linked-app.js';
import { verifyCloudflareCompilerFaults } from './fixtures/cloudflare-compiler-faults.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
it('preserves private native compiler diagnostics, redacts public SSR failure, and recovers in the same process', async () => {
  const installedRoot = process.env.COSSACK_COMPILER_FAULTS_INSTALLED_ROOT;
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-native-compiler-faults-'));
  try {
    let root;
    if (installedRoot) {
      const require = createRequire(path.join(installedRoot, 'package.json'));
      const metadata = require.resolve('@cossackframework/scaffold/package.json');
      const pkg = JSON.parse(await fs.readFile(metadata, 'utf8'));
      const scaffold = await import(pathToFileURL(path.resolve(path.dirname(metadata), pkg.exports['.'].import)).href);
      ({ projectDir: root } = await scaffold.createApp('app', { cwd: parent, adapter: 'cloudflare', preset: 'minimal', interactive: false }));
      await fs.symlink(path.join(installedRoot, 'node_modules'), path.join(root, 'node_modules'), 'junction');
    } else root = await scaffoldLinkedApp(parent, { adapter: 'cloudflare', packages: ['framework', 'core', 'renderer', 'scaffold'] });
    // This test is about a Worker that fails to start. With pages loaded on first use, a
    // malformed page fails its own route only, so the page is imported up front here.
    const viteConfig = path.join(root, 'vite.config.ts');
    const configText = await fs.readFile(viteConfig, 'utf8');
    if (!configText.includes('cossackApp({')) throw new Error('vite.config.ts no longer calls cossackApp({');
    await fs.writeFile(viteConfig, configText.replace('cossackApp({', 'cossackApp({\n  pages: { deferPages: false },'));
    expect(await verifyCloudflareCompilerFaults(root, { allowedPaths: installedRoot ? [installedRoot] : [repository] })).toMatchObject({ recovered: true });
  } finally { await fs.rm(parent, { recursive: true, force: true }); }
}, 150000);
