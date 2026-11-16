import { readFileSync } from 'node:fs';
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

  it('leaves builds and the Node runtime as they were', async () => {
    expect((await cossackVite({ root: process.cwd(), runtime: 'cloudflare', mode: 'production', command: 'build' })).config).toBeUndefined();
    const node: any = await cossackVite({ root: process.cwd(), runtime: 'node', mode: 'development', command: 'serve' });
    expect(node.config.environments.ssr.optimizeDeps).toBeUndefined();
    expect(node.config.environments.ssr.resolve.external).toContain('@romedb/client');
  });
});
