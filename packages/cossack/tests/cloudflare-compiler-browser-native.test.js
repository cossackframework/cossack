import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { it, expect } from 'vitest';
import { createApp } from '@cossackframework/scaffold';
import { verifyCompilerBrowserPrivacy } from './fixtures/cloudflare-compiler-browser-native.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
it('redacts malformed startup and browser overlay/HMR compiler errors, then recovers', async () => {
  const installedRoot = process.env.COSSACK_COMPILER_BROWSER_INSTALLED_ROOT;
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-compiler-browser-'));
  try {
    let scaffold = { createApp };
    if (installedRoot) {
      const require = createRequire(path.join(installedRoot, 'package.json'));
      const metadata = require.resolve('@cossackframework/scaffold/package.json');
      const pkg = JSON.parse(await fs.readFile(metadata, 'utf8'));
      scaffold = await import(pathToFileURL(path.resolve(path.dirname(metadata), pkg.exports['.'].import)).href);
    }
    const { projectDir: root } = await scaffold.createApp('app', { cwd: parent, adapter: 'cloudflare', preset: 'minimal', interactive: false });
    const modules = path.join(root, 'node_modules');
    if (installedRoot) await fs.symlink(path.join(installedRoot, 'node_modules'), modules, 'junction');
    else {
      await fs.mkdir(modules);
      for (const name of await fs.readdir(path.join(repository, 'node_modules'))) {
        if (name.startsWith('.') || name === '@cossackframework') continue;
        await fs.symlink(path.join(repository, 'node_modules', name), path.join(modules, name), 'junction');
      }
      await fs.mkdir(path.join(modules, '@cossackframework'));
      for (const name of ['framework', 'core', 'renderer', 'scaffold']) await fs.symlink(path.join(repository, 'packages', name), path.join(modules, '@cossackframework', name), 'junction');
    }
    expect(await verifyCompilerBrowserPrivacy(root, { allowedPaths: installedRoot ? [installedRoot] : [repository] })).toMatchObject({ recovered: true });
  } finally { await fs.rm(parent, { recursive: true, force: true }); }
}, 180000);
