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

// An app middleware that runs for every request: it marks responses cacheable, then denies the dashboard.
globals.push(async (c: any, next: any) => {
    c.header('Cache-Control', 'public, max-age=600');
    if (c.req.path.startsWith('/dashboard')) throw forbidden();
    await next();
});

@Page({ transport: 'http' })
class CatchAll extends Cossack { render() { return html`<main>site page</main>`; } }
@Page({ transport: 'http' })
class RootError extends Cossack { render() { return html`<h1>Root error page</h1>`; } }
@Page({ transport: 'http' })
class DashboardError extends Cossack { render() { return html`<h1>Dashboard error page</h1>`; } }
@Page({ transport: 'http' })
class Settings extends Cossack { render() { return html`<p>settings</p>`; } }

registry.pages['/src/pages/[...path]/index.ts'] = { default: CatchAll };
registry.pages['/src/pages/error/index.ts'] = { default: RootError };
registry.pages['/src/pages/dashboard/error/index.ts'] = { default: DashboardError };
registry.pages['/src/pages/dashboard/settings/index.ts'] = { default: Settings };
const { createApp } = await import('../src/router');

describe('denials from an app-wide middleware', () => {
    it('render the most specific route\'s error page, never cached', async () => {
        const response = await createApp().request('/dashboard/settings', { headers: { accept: 'text/html' } }, {} as any);
        expect(response.status).toBe(403);
        const markup = await response.text();
        expect(markup).toContain('Dashboard error page');
        expect(markup).not.toContain('Root error page');
        expect(response.headers.get('cache-control')).toBe('private, no-store');
    });
});
