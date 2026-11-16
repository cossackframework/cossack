import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureWorkerLoader, pluginRuntime, runtimeLine } from '../src/plugin-isolation.js';

const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

async function project(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-isolation-'));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content);
  }
  return root;
}

const manifest = (extra = {}) => JSON.stringify({ name: 'desk', version: '1.0.0', ...extra });

describe('isolated plugins in the CLI', () => {
  it('says where a rendered plugin runs, from its files and the runtime', async () => {
    const cloudflare = await project({ '.cossack/scaffold.json': '{"adapter":"cloudflare"}', 'src/plugins/desk/plugin.json': manifest(), 'src/plugins/desk/server.ts': 'export {}' });
    const isolated = await pluginRuntime(cloudflare, 'desk');
    expect(isolated).toMatchObject({ mode: 'isolated', server: true, runtime: 'cloudflare' });
    expect(runtimeLine('desk', isolated)).toBe('desk runs isolated: its server code gets a Worker of its own, and reaches only what it is granted.');
    await fs.writeFile(path.join(cloudflare, 'src/plugins/desk/ui.ts'), 'export {}');
    expect(runtimeLine('desk', await pluginRuntime(cloudflare, 'desk'))).toBe('desk runs in the application. It has ui.ts, which runs in the application. Its permissions are checked at build, not enforced.');
    const node = await project({ '.cossack/scaffold.json': '{"adapter":"node"}', 'src/plugins/desk/plugin.json': manifest(), 'src/plugins/desk/server.ts': 'export {}' });
    expect(await pluginRuntime(node, 'desk')).toMatchObject({ mode: 'app', reason: 'Node.js has no Worker Loader, so its server code runs in the application.' });
    const inApp = await project({ '.cossack/scaffold.json': '{"adapter":"cloudflare"}', 'src/plugins/desk/plugin.json': manifest({ isolation: false }), 'src/plugins/desk/server.ts': 'export {}' });
    expect(await pluginRuntime(inApp, 'desk')).toMatchObject({ mode: 'app', reason: 'It was added with --in-app.' });
  });

  it('adds the Worker Loader binding once, to the configuration and each environment, keeping comments', async () => {
    const root = await project({ 'wrangler.jsonc': `{
  // The application's Worker.
  "name": "app",
  "main": "./src/index.ts",
  "env": {
    "staging": { "name": "app-staging" },
    "production": { "name": "app", "worker_loaders": [{ "binding": "LOADER" }] }
  }
}
` });
    expect(await ensureWorkerLoader(root)).toBe(path.join(root, 'wrangler.jsonc'));
    const text = await fs.readFile(path.join(root, 'wrangler.jsonc'), 'utf8');
    expect(text).toContain("// The application's Worker.");
    const config = JSON.parse(text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));
    expect(config.worker_loaders).toEqual([{ binding: 'LOADER' }]);
    expect(config.env.staging.worker_loaders).toEqual([{ binding: 'LOADER' }]);
    expect(config.env.production.worker_loaders).toEqual([{ binding: 'LOADER' }]);
    expect(await ensureWorkerLoader(root)).toBeNull();
  });

  it('leaves configurations it cannot edit to people', async () => {
    const toml = await project({ 'wrangler.toml': 'name = "app"\n' });
    await expect(ensureWorkerLoader(toml)).rejects.toMatchObject({ code: 'COSSACK_CONFIG_EDIT_UNSUPPORTED', message: expect.stringContaining('"worker_loaders": [{ "binding": "LOADER" }]') });
    expect(await ensureWorkerLoader(await project({}))).toBeNull();
  });
});
