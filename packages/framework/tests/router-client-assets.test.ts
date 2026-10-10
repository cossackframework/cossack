import 'reflect-metadata';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const { registry } = vi.hoisted(() => ({ registry: {
  pages: {} as Record<string, unknown>, layouts: {}, loadings: {},
} }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ default: {}, requirements: {}, environment: undefined }));

@Page({ transport: 'http' })
class AssetPage extends Cossack {
  render() { return html`<main>SSR asset test</main>`; }
}
registry.pages['/src/pages/index.ts'] = { default: AssetPage };

// Transform the SSR dependency graph during collection, like the other router
// suites. Cold imports under full-suite load must not consume a request test's
// timeout. A unique query reloads only the router's asset caches per case;
// resetModules would also reload every dependency and change class identities.
await import('../src/router');
let routerInstance = 0;
let createApp: typeof import('../src/router').createApp;
beforeEach(async () => {
  vi.stubEnv('DEV', false);
  const router = await import(/* @vite-ignore */ `../src/router.ts?client-assets-test=${routerInstance++}`) as typeof import('../src/router');
  createApp = router.createApp;
});
afterEach(() => { vi.unstubAllEnvs(); });

async function render(css: string, manifestStatus = 200, cssStatus = 200, development = false) {
  vi.stubEnv('DEV', development);
  const app = createApp();
  const fetch = vi.fn(async (request: Request) => {
    if (new URL(request.url).pathname === '/cossack-manifest.json') {
      return new Response(JSON.stringify({ 'src/client/entry-client.ts': {
        file: 'assets/entry.abc12345.js', css: ['assets/style.abc12345.css'],
      } }), { status: manifestStatus });
    }
    if (new URL(request.url).pathname === '/assets/style.abc12345.css') {
      return new Response(css, { status: cssStatus });
    }
    return new Response(null, { status: 404 });
  });
  const response = await app.request('/', undefined, { ASSETS: { fetch } });
  expect(response.status).toBe(200);
  return { html: await response.text(), fetch };
}

it('resolves hashed client assets and inlines CSS through ASSETS.fetch', async () => {
  const { html, fetch } = await render('body { color: red; }');
  expect(html).toContain('/assets/entry.abc12345.js');
  expect(html).toContain('<style>body { color: red; }</style>');
  expect(html).toContain('/assets/style.abc12345.css');
  expect(fetch.mock.calls.map(([request]) => new URL(request.url).pathname))
    .toContain('/cossack-manifest.json');
});

it.each([['large', 'x'.repeat(25601), 200], ['missing', '', 404]] as const)
  ('keeps a stylesheet link when CSS is %s', async (_name, css, status) => {
    const { html } = await render(css, 200, status);
    expect(html).toContain('/assets/style.abc12345.css');
    expect(html).not.toContain('<style>');
  });

it('falls back when the manifest is missing', async () => {
  const { html } = await render('', 404);
  expect(html).toContain('/src/client/entry-client.ts');
  expect(html).not.toContain('/assets/entry.abc12345.js');
});

it('ignores stale built assets in development', async () => {
  const { html, fetch } = await render('body {}', 200, 200, true);
  expect(html).toContain('/src/client/entry-client.ts');
  expect(fetch.mock.calls.map(([request]) => new URL(request.url).pathname))
    .not.toContain('/cossack-manifest.json');
});

it('renders without an ASSETS binding', async () => {
  vi.stubEnv('DEV', false);
  const response = await createApp().request('/');
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('/src/client/entry-client.ts');
});
