import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const { registry } = vi.hoisted(() => ({ registry: { pages: {} as Record<string, unknown>, layouts: {}, loadings: {} } }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

@Page({ transport: 'http' })
class Home extends Cossack {
    render() { return html`<p>home</p>`; }
}

@Page({ transport: 'http' })
class NotFound extends Cossack {
    render() { return html`<h1>Custom 404 page</h1>`; }
}

registry.pages['/src/pages/index.ts'] = { default: Home };
registry.pages['/src/pages/404/index.ts'] = { default: NotFound };
const { createApp } = await import('../src/router');

describe('app.notFound', () => {
    it.each(['GET', 'HEAD'])('renders the HTML 404 page for a %s page request', async method => {
        const response = await createApp().request('/missing', { method }, {} as any);
        expect(response.status).toBe(404);
        expect(response.headers.get('content-type')).toMatch(/text\/html/);
        if (method === 'GET') expect(await response.text()).toContain('Custom 404 page');
    });

    it.each(['/api', '/api/missing', '/api/v1/deep/missing'])('returns JSON 404 for the API path %s', async path => {
        const response = await createApp().request(path, {}, {} as any);
        expect(response.status).toBe(404);
        expect(response.headers.get('content-type')).toMatch(/application\/json/);
        expect(await response.json()).toMatchObject({ code: 'COSSACK_NOT_FOUND', error: 'Not Found' });
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('returns JSON 404 for a %s from a JSON client', async method => {
        const response = await createApp().request('/missing', { method, headers: { accept: 'application/json' } }, {} as any);
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: 'COSSACK_NOT_FOUND' });
    });

    it('renders the HTML 404 boundary for a browser form POST to a page path', async () => {
        const response = await createApp().request('/missing', {
            method: 'POST', headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
        }, {} as any);
        expect(response.status).toBe(404);
        expect(await response.text()).toContain('Custom 404 page');
    });
});
