import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const { registry, globals } = vi.hoisted(() => ({
    registry: { pages: {} as Record<string, unknown>, layouts: {} as Record<string, unknown>, loadings: {}, owners: {} as Record<string, string> },
    globals: [] as unknown[],
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: globals }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

const forbidden = () => Object.assign(new Error('PRIVATE'), { authorizationCode: 'COSSACK_AUTH_FORBIDDEN' });

// An app middleware that denies the shop before any route runs.
globals.push(async (c: any, next: any) => {
    if (c.req.path.startsWith('/shop')) throw forbidden();
    await next();
});

@Page({ transport: 'http' })
class CatchAll extends Cossack { render() { return html`<main>site page</main>`; } }
@Page({ transport: 'http' })
class RootError extends Cossack { render() { return html`<h1>Root error page</h1>`; } }
@Page({ transport: 'http' })
class ShopPage extends Cossack { render() { return html`<p>shop</p>`; } }
@Page({ transport: 'http' })
class ShopError extends Cossack { render() { return html`<h1>Shop plugin error page</h1>`; } }

registry.pages['/src/pages/[...path]/index.ts'] = { default: CatchAll };
registry.pages['/src/pages/error/index.ts'] = { default: RootError };
registry.pages['/src/pages/shop/[...rest]/index.ts'] = { default: ShopPage };
registry.pages['/src/pages/shop/error/index.ts'] = { default: ShopError };
// A plugin endpoint the same URL also matches.
registry.pages['/src/pages/shop/feed/index.ts'] = { GET: () => new Response('feed') };
registry.owners['/src/pages/shop/[...rest]/index.ts'] = 'shop';
registry.owners['/src/pages/shop/error/index.ts'] = 'shop';
registry.owners['/src/pages/shop/feed/index.ts'] = 'shop';
const { createApp } = await import('../src/router');

describe('denials from an app-wide middleware with an inactive plugin on the URL', () => {
    const app = (active: boolean) => createApp({ isPluginActive: () => active } as any);

    it('render the app\'s error page as HTML, not the inactive plugin\'s or JSON', async () => {
        for (const path of ['/shop/cart', '/shop/feed']) {
            const response = await app(false).request(path, { headers: { accept: 'text/html' } }, {} as any);
            expect(response.status).toBe(403);
            expect(response.headers.get('content-type') ?? '').toContain('text/html');
            const markup = await response.text();
            expect(markup).toContain('Root error page');
            expect(markup).not.toContain('Shop plugin error page');
        }
    });

    it('render the plugin\'s own error page while it is active', async () => {
        const response = await app(true).request('/shop/cart', { headers: { accept: 'text/html' } }, {} as any);
        expect(response.status).toBe(403);
        expect(await response.text()).toContain('Shop plugin error page');
    });
});
