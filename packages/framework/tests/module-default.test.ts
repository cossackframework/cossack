import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { getModuleDefault } from '../src/module-default';
import { collectSsgRoutes } from '../src/ssg-renderer';
const { registry } = vi.hoisted(() => ({ registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} } }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ default: {} }));
@Page({ ssg: true })
class Actual extends Cossack { render() { return html`<main>selected default page</main>`; } }
@Page()
class Layout extends Cossack { render() { return html`<section>selected default layout${this.children}</section>`; } }
@Page()
class Wrong extends Cossack { constructor() { super(); throw new Error('named helper must not be constructed'); } }
registry.pages['/src/pages/index.ts'] = { AHelper: Wrong, default: Actual };
registry.pages['/src/pages/api/items.ts'] = { GET: (c: any) => c.json({ ok: true }) };
registry.layouts['/src/pages/layout.ts'] = { AHelper: Wrong, default: Layout };
const { createApp } = await import('../src/router');
it('renders the default page and layout even when named helpers come first', async () => {
  const response = await createApp().request('/');
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toContain('selected default page');
  expect(body).toContain('selected default layout');
});
it('discovers the same default component for static generation', () => {
  expect(collectSsgRoutes(registry.pages, registry.layouts)).toMatchObject([{ component: Actual }]);
});
it('keeps named functional HTTP handlers working without a default export', async () => {
  const response = await createApp().request('/api/items');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
it('never substitutes a named export for a missing component default', () => {
  expect(getModuleDefault({ AHelper: Wrong })).toBeUndefined();
  expect(getModuleDefault(undefined)).toBeUndefined();
});
