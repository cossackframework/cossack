import { expect, it } from 'vitest';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';

it('scans the published router in dev without filesystem, path, or URL imports', async () => {
  const forbidden = /^(?:node:)?(?:fs|path|url)(?:\/|$)/;
  const result = await build({
    configFile: false, logLevel: 'silent',
    define: { 'import.meta.env.DEV': 'true' },
    build: {
      write: false, minify: false,
      lib: { entry: fileURLToPath(new URL('../dist/esm/router.js', import.meta.url)), formats: ['es'] },
      rolldownOptions: {
        external(id) {
          // Resolution also scans dynamic imports in functions that dev never
          // calls. Fail here, before tree shaking can hide a Node fallback.
          if (forbidden.test(id)) throw new Error(`Unexpected Worker import: ${id}`);
          return !id.startsWith('.') && !id.startsWith('/');
        },
      },
    },
  });
  const bundles = Array.isArray(result) ? result : [result];
  const code = bundles.flatMap(bundle => 'output' in bundle ? bundle.output : [])
    .filter(chunk => chunk.type === 'chunk').map(chunk => chunk.code).join('\n');
  expect(code).toContain('createApp');
}, 30_000);
