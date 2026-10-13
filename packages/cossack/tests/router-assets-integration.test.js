import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanupRoots, project, productionServer, vite } from './fixtures/generated-app.js';

afterEach(cleanupRoots);

it('loads the generated Node client manifest and inline CSS from its own output directory', async () => {
  const root = await project('node');
  await fs.writeFile(path.join(root, 'src/style.css'), 'body { color: rgb(1, 2, 3); }');
  // The server builds before the manifest exists, as in the reported setup.
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  await vite(root, []);
  const clientRoot = path.join(root, 'dist/client');
  const manifest = JSON.parse(await fs.readFile(path.join(clientRoot, 'cossack-manifest.json'), 'utf8'));
  const entry = manifest['src/client/entry-client.ts'];
  expect(entry.css).toHaveLength(1);
  const css = await fs.readFile(path.join(clientRoot, entry.css[0]), 'utf8');
  const runtime = await productionServer(root);
  try {
    const response = await fetch(runtime.origin);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(`src="/${entry.file}"`);
    expect(html).toContain(`<style>${css}</style>`);
    expect(html).toContain(`href="/${entry.css[0]}"`);
    expect(html).not.toContain('/src/client/entry-client.ts');
    expect((await fetch(`${runtime.origin}/${entry.file}`)).status).toBe(200);
  } finally { await runtime.close(); }
}, 120_000);
