import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { it, expect } from 'vitest';
import { scaffoldLinkedApp } from './fixtures/linked-app.js';
import { verifyCompilerBrowserPrivacy } from './fixtures/cloudflare-compiler-browser-native.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
it('redacts malformed startup and browser overlay/HMR compiler errors, then recovers', async () => {
  const installedRoot = process.env.COSSACK_COMPILER_BROWSER_INSTALLED_ROOT;
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-compiler-browser-'));
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
    expect(await verifyCompilerBrowserPrivacy(root, { allowedPaths: installedRoot ? [installedRoot] : [repository] })).toMatchObject({ recovered: true });
  } finally { await fs.rm(parent, { recursive: true, force: true }); }
}, 180000);
