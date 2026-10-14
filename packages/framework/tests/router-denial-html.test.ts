import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const { registry } = vi.hoisted(() => ({ registry: { pages: {} as Record<string, unknown>, layouts: {}, loadings: {} } }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

const denial = (code: 'COSSACK_AUTH_FORBIDDEN' | 'COSSACK_AUTH_UNAUTHENTICATED') =>
    Object.assign(new Error('PRIVATE_DENIAL_DETAIL'), { authorizationCode: code });

@Page({ transport: 'http' })
class SecretPage extends Cossack {
    async init() { throw denial('COSSACK_AUTH_FORBIDDEN'); }
    render() { return html`<p>secret</p>`; }
}

@Page({ transport: 'http', middlewares: [async () => { throw denial('COSSACK_AUTH_UNAUTHENTICATED'); }] })
class GuardedPage extends Cossack {
    render() { return html`<p>guarded</p>`; }
}

@Page({ transport: 'http' })
class ErrorBoundary extends Cossack {
    render() { return html`<h1>Boundary page</h1>`; }
}

@Page({ transport: 'http' })
class ThingApi extends Cossack {
    async get() { throw denial('COSSACK_AUTH_FORBIDDEN'); }
}

registry.pages['/src/pages/secret/index.ts'] = { default: SecretPage };
registry.pages['/src/pages/guarded/index.ts'] = { default: GuardedPage };
registry.pages['/src/pages/error/index.ts'] = { default: ErrorBoundary };
registry.pages['/src/pages/api/thing.ts'] = { default: ThingApi };
const { createApp } = await import('../src/router');

const browser = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };

describe('authorization denials on page routes', () => {
    it.each([
        ['/secret', 403, 'SSR'],
        ['/guarded', 401, 'route middleware'],
    ] as const)('renders the error boundary with the denial status for a browser navigation to %s (%s)', async (path, status, _source) => {
        const response = await createApp().request(path, { headers: browser }, {} as any);
        expect(response.status).toBe(status);
        expect(response.headers.get('content-type')).toMatch(/text\/html/);
        const markup = await response.text();
        expect(markup).toContain('Boundary page');
        expect(markup).not.toContain('PRIVATE_DENIAL_DETAIL');
        expect(response.headers.get('X-Cossack-Request-Id')).toBeTruthy();
    });

    it.each([
        ['/secret', 403, 'COSSACK_AUTH_FORBIDDEN'],
        ['/guarded', 401, 'COSSACK_AUTH_UNAUTHENTICATED'],
    ] as const)('keeps JSON for non-HTML clients of %s', async (path, status, code) => {
        const response = await createApp().request(path, { headers: { accept: 'application/json' } }, {} as any);
        expect(response.status).toBe(status);
        expect(await response.json()).toMatchObject({ code });
    });

    it('keeps JSON for API routes even when the client accepts HTML', async () => {
        const response = await createApp().request('/api/thing', { headers: browser }, {} as any);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: 'COSSACK_AUTH_FORBIDDEN' });
    });
});
