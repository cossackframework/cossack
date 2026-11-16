import 'reflect-metadata';
import { beforeAll, expect, it, vi } from 'vitest';
import { Cossack, Page, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const { registry } = vi.hoisted(() => ({ registry: {
  pages: {} as Record<string, unknown>, layouts: {} as Record<string, unknown>, loadings: {} as Record<string, unknown>,
} }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ default: {}, requirements: {}, environment: undefined }));

class Skeleton extends Cossack {
  render() { return html`<p>skeleton</p>`; }
}

/** A page with a `loading.ts` next to it and a real init(): SSR must still run init(). */
@Page({ transport: 'http' })
class HomePage extends Cossack {
  @State() status = 'initial';
  async init() { this.status = 'loaded by init'; }
  render() { return html`<main>${this.status}</main>`; }
}

/** loadingTemplate() alone: nothing would run init() later, so SSR runs it. */
@Page({ transport: 'http' })
class TemplatePage extends Cossack {
  @State() status = 'initial';
  async init() { this.status = 'loaded by init'; }
  loadingTemplate() { return html`<p>template skeleton</p>`; }
  render() { return this.loading.init ? this.loadingTemplate() : html`<main>${this.status}</main>`; }
}

/** loadingTemplate() + clientInit(): the page opts into deferring init() to the client. */
@Page({ transport: 'http' })
class DeferredPage extends Cossack {
  @State() status = 'initial';
  async init() { this.status = 'loaded by init'; }
  async clientInit() { await this.init(); }
  loadingTemplate() { return html`<p>template skeleton</p>`; }
  render() { return this.loading.init ? this.loadingTemplate() : html`<main>${this.status}</main>`; }
}

registry.pages['/src/pages/app/index.ts'] = { default: HomePage };
registry.loadings['/src/pages/app/loading.ts'] = { default: Skeleton };
registry.pages['/src/pages/template/index.ts'] = { default: TemplatePage };
registry.pages['/src/pages/deferred/index.ts'] = { default: DeferredPage };

let createApp: typeof import('../src/router').createApp;
beforeAll(async () => {
  ({ createApp } = await import('../src/router'));
});

const env = { ASSETS: { fetch: async () => new Response(null, { status: 404 }) } };

it('runs init() during SSR when a loading.ts file sits next to the page', async () => {
  const response = await createApp().request('/app', undefined, env);
  expect(response.status).toBe(200);
  const document = await response.text();
  expect(document).toContain('loaded by init');
  expect(document).not.toContain('skeleton');
});

it('runs init() during SSR when the page has loadingTemplate() but no clientInit()', async () => {
  const document = await (await createApp().request('/template', undefined, env)).text();
  expect(document).toContain('loaded by init');
  expect(document).not.toContain('template skeleton');
});

it('skips init() during SSR only when loadingTemplate() and clientInit() are both defined', async () => {
  const document = await (await createApp().request('/deferred', undefined, env)).text();
  expect(document).toContain('template skeleton');
  expect(document).not.toContain('loaded by init');
});
