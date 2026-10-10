import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';

const { registry } = vi.hoisted(() => ({ registry: {
  pages: {} as Record<string, unknown>, layouts: {}, loadings: {},
} }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ default: {}, requirements: {}, environment: undefined }));

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function createTestApp() {
  const { Cossack, Page } = await import('@cossackframework/core');
  const { html } = await import('@cossackframework/renderer');
  @Page({ transport: 'http' })
  class AssetPage extends Cossack {
    render() { return html`<main>SSR asset test</main>`; }
  }
  registry.pages['/src/pages/index.ts'] = { default: AssetPage };
  const { createApp } = await import('../src/router');
  return createApp();
}

async function render(css: string, manifestStatus = 200, cssStatus = 200, development = false) {
  vi.stubEnv('DEV', development);
  const app = await createTestApp();
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
  const app = await createTestApp();
  const response = await app.request('/');
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('/src/client/entry-client.ts');
});
