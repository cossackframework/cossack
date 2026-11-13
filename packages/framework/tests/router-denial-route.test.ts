import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const { registry } = vi.hoisted(() => ({
    registry: { pages: {} as Record<string, unknown>, layouts: {} as Record<string, unknown>, loadings: {}, owners: {} as Record<string, string> },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

const forbidden = () => Object.assign(new Error('PRIVATE'), { authorizationCode: 'COSSACK_AUTH_FORBIDDEN' });

@Page({ transport: 'http' })
class CatchAll extends Cossack { render() { return html`<main>site page</main>`; } }
@Page({ transport: 'http' })
class RootError extends Cossack { render() { return html`<h1>Root error page</h1>`; } }
@Page({ transport: 'http' })
class DashboardError extends Cossack { render() { return html`<h1>Dashboard error page</h1>`; } }
// The dashboard layout's guard denies: the dashboard's own error page answers, not the root one
// the catch-all would pick.
@Page({ transport: 'http', middlewares: [async () => { throw forbidden(); }] })
class DashboardLayout extends Cossack { render() { return html`<section>${this.children}</section>`; } }
@Page({ transport: 'http' })
class Settings extends Cossack { render() { return html`<p>settings</p>`; } }
// The catch-all's layout denies /private/*: an inactive plugin's endpoint at the same path only matched.
@Page({ transport: 'http', middlewares: [async (c: any, next: any) => { if (c.req.path.startsWith('/private')) throw forbidden(); await next(); }] })
class SiteLayout extends Cossack { render() { return html`<div>${this.children}</div>`; } }
const feed = vi.fn((c: any) => c.text('plugin feed'));

registry.pages['/src/pages/[...path]/index.ts'] = { default: CatchAll };
registry.layouts['/src/pages/layout.ts'] = { default: SiteLayout };
registry.pages['/src/pages/error/index.ts'] = { default: RootError };
registry.pages['/src/pages/dashboard/error/index.ts'] = { default: DashboardError };
registry.layouts['/src/pages/dashboard/layout.ts'] = { default: DashboardLayout };
registry.pages['/src/pages/dashboard/settings/index.ts'] = { default: Settings };
registry.pages['/src/pages/private/feed/index.ts'] = { GET: feed };
registry.owners['/src/pages/private/feed/index.ts'] = 'feeds';
const { createApp } = await import('../src/router');

const browser = { accept: 'text/html,application/xhtml+xml' };

describe('denials belong to the route that ran', () => {
    it('renders the denied route\'s nearest error page, not the catch-all\'s', async () => {
        const response = await createApp().request('/dashboard/settings', { headers: browser }, {} as any);
        expect(response.status).toBe(403);
        const markup = await response.text();
        expect(markup).toContain('Dashboard error page');
        expect(markup).not.toContain('Root error page');
    });

    it('answers a browser with the HTML denial when an inactive plugin\'s endpoint only matched', async () => {
        const response = await createApp({ isPluginActive: async () => false }).request('/private/feed', { headers: browser }, {} as any);
        expect(response.status).toBe(403);
        expect(response.headers.get('content-type')).toMatch(/text\/html/);
        expect(await response.text()).toContain('Root error page');
        expect(feed).not.toHaveBeenCalled();
    });
});
