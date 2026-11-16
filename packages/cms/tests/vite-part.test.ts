import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cossackVite } from '../src/vite.js';

const exportsOf = (name: string) => Object.keys(JSON.parse(readFileSync(new URL(`../../${name}/package.json`, import.meta.url), 'utf8')).exports);

describe('the CMS part of a project\'s Vite configuration', () => {
  it('pre-bundles the CMS library and the RomeDB bindings for the Workers development server', async () => {
    const part: any = await cossackVite({ root: process.cwd(), runtime: 'cloudflare', mode: 'development', command: 'serve' });
    const include: string[] = part.config.environments.ssr.optimizeDeps.include;
    // Every server entry in one pass: an entry left out would load from source beside the
    // bundle, with a second copy of the state they share.
    expect(include).toEqual(expect.arrayContaining(['@cossackframework/cms', '@cossackframework/cms/server',
      '@cossackframework/cms/storage', '@cossackframework/cms/storage/cloudflare', '@cossackframework/cms/cloudflare',
      '@cossackframework/romedb', '@cossackframework/romedb/cloudflare']));
    // Each one is an entry the packages export.
    for (const specifier of include) {
      const [, name, ...rest] = specifier.split('/');
      expect(exportsOf(name!), specifier).toContain(rest.length ? `./${rest.join('/')}` : '.');
    }
  });

  it('names the Worker entrypoints the project exports, in development only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cossack-cms-vite-part-'));
    try {
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src/index.ts'), "export { RomeDBPendingWrites, PluginBridge, PluginTail } from '@cossackframework/cms/app/cms/worker';\n");
      const worker = { name: 'site', main: join(root, 'src/index.ts'), services: [] };
      const serve: any = await cossackVite({ root, runtime: 'cloudflare', mode: 'development', command: 'serve' });
      // The local runtime starts once when the configuration names what the Worker exports.
      expect(serve.cloudflare.config(worker).services).toEqual([
        { binding: 'COSSACK_DEV_PLUGIN_BRIDGE', service: 'site', entrypoint: 'PluginBridge' },
        { binding: 'COSSACK_DEV_PLUGIN_TAIL', service: 'site', entrypoint: 'PluginTail' },
      ]);
      // One the project already binds is not named twice; one it does not export is not named at all.
      expect(serve.cloudflare.config({ ...worker, services: [{ binding: 'BRIDGE', service: 'site', entrypoint: 'PluginBridge' }] }).services)
        .toEqual([{ binding: 'COSSACK_DEV_PLUGIN_TAIL', service: 'site', entrypoint: 'PluginTail' }]);
      writeFileSync(join(root, 'src/index.ts'), "export { RomeDBPendingWrites } from '@cossackframework/cms/app/cms/worker';\n");
      expect(serve.cloudflare.config(worker).services).toBeUndefined();
      // A build's configuration is the deployed one: nothing is added.
      const build: any = await cossackVite({ root, runtime: 'cloudflare', mode: 'production', command: 'build' });
      writeFileSync(join(root, 'src/index.ts'), "export { PluginBridge, PluginTail } from '@cossackframework/cms/app/cms/worker';\n");
      expect(build.cloudflare.config(worker).services).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('leaves builds and the Node runtime as they were', async () => {
    expect((await cossackVite({ root: process.cwd(), runtime: 'cloudflare', mode: 'production', command: 'build' })).config).toBeUndefined();
    const node: any = await cossackVite({ root: process.cwd(), runtime: 'node', mode: 'development', command: 'serve' });
    expect(node.config.environments.ssr.optimizeDeps).toBeUndefined();
    expect(node.config.environments.ssr.resolve.external).toContain('@romedb/client');
  });
});
