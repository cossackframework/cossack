// Realtime state shared across different page files, in generated production
// apps on Node and in workerd: a realtime layout with a per-user scope and a
// realtime child component embedded in several pages.
import { afterEach, beforeAll, describe, it } from 'vitest';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createTestHarness } from 'wrangler';
import { cleanupRoots, productionServer, sharedApps, vite } from './fixtures/generated-app.js';
import { checkRealtimeSharedBrowser, checkRealtimeSharedProtocol, writeRealtimeSharedAcceptance } from './fixtures/realtime-shared-acceptance.js';

afterEach(cleanupRoots);

describe('realtime layouts and components shared across pages in generated production apps', () => {
  const shared = sharedApps();
  let nodeRoot, workerRoot;
  beforeAll(async () => {
    [nodeRoot, workerRoot] = await Promise.all([shared('node'), shared('cloudflare')]);
    await Promise.all([writeRealtimeSharedAcceptance(nodeRoot), writeRealtimeSharedAcceptance(workerRoot)]);
    await vite(nodeRoot, []);
    await vite(nodeRoot, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
    await vite(workerRoot, []);
  }, 300000);

  async function withOrigin(adapter, check) {
    if (adapter === 'node') {
      const server = await productionServer(nodeRoot);
      try { await check(server.origin); }
      catch (error) { throw new Error(`${error.stack ?? error}\n${server.diagnostics()}`); }
      finally { await server.close(); }
      return;
    }
    const harness = createTestHarness({ root: workerRoot, workers: [{ configPath: path.join(workerRoot, 'dist/ssr/wrangler.json') }] });
    try { const { url } = await harness.listen(); await check(new URL(url).origin); }
    finally { await harness.close(); }
  }

  it.each(['node', 'cloudflare'])('authorizes and recomputes every realtime layout and component target on %s', async adapter => {
    await withOrigin(adapter, origin => checkRealtimeSharedProtocol(origin));
  }, 120000);

  it.each(['node', 'cloudflare'])('shares live layout and component state across pages, tabs and navigation on %s', async adapter => {
    await withOrigin(adapter, async origin => {
      const browser = await chromium.launch({ headless: true });
      try { await checkRealtimeSharedBrowser(browser, origin); }
      finally { await browser.close(); }
    });
  }, 180000);
});
