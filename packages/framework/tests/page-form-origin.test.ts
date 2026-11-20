import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { isSameOriginRequest } from '../src/form-origin';

const { registry } = vi.hoisted(() => ({ registry: { pages: {} as Record<string, any>, layouts: {}, loadings: {} } }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

let posts = 0;
@Page({ transport: 'http' })
class ContactPage extends Cossack {
    async post() { posts++; return new Response('saved'); }
    render() { return html`contact`; }
}
@Page({ transport: 'http', allowCrossSiteForms: true })
class CallbackPage extends Cossack {
    async post() { posts++; return new Response('called back'); }
    render() { return html`callback`; }
}
registry.pages['/src/pages/contact.ts'] = { default: ContactPage };
registry.pages['/src/pages/callback.ts'] = { default: CallbackPage };
const { createApp } = await import('../src/router');

const form = (path: string, headers: Record<string, string>) => createApp().request(path, {
    method: 'POST', body: 'name=Ada', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
}, {} as any);

describe("a page's post() and forms on other sites", () => {
    it('refuses a cross-site form post with 403 and runs nothing', async () => {
        posts = 0;
        const refused = await form('/contact', { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' });
        expect(refused.status).toBe(403);
        expect(await refused.json()).toMatchObject({ code: 'COSSACK_CROSS_SITE_REQUEST' });
        expect((await form('/contact', { Origin: 'https://evil.example' })).status).toBe(403);
        expect((await form('/contact', { 'Content-Type': 'text/plain', Origin: 'https://evil.example' })).status).toBe(403);
        expect(posts).toBe(0);
    });

    it('accepts its own forms, also with Origin: null under Referrer-Policy: no-referrer', async () => {
        posts = 0;
        expect((await form('/contact', { 'Sec-Fetch-Site': 'same-origin', Origin: 'null' })).status).toBe(200);
        expect((await form('/contact', { Origin: 'http://localhost' })).status).toBe(200);
        expect((await form('/contact', {})).status).toBe(200);
        expect(posts).toBe(3);
    });

    it('leaves JSON bodies to CORS and lets a page allow forms from other sites', async () => {
        posts = 0;
        const json = await createApp().request('/contact', { method: 'POST', body: '{}',
            headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site', Origin: 'https://app.example' } }, {} as any);
        expect(json.status).toBe(200);
        expect((await form('/callback', { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://appleid.apple.com' })).status).toBe(200);
        expect(posts).toBe(2);
    });

    it('decides by Sec-Fetch-Site, and by Origin for a subdomain or an older browser', () => {
        const request = (headers: Record<string, string>) => new Request('https://shop.example/contact', { method: 'POST', headers });
        expect(isSameOriginRequest(request({ 'Sec-Fetch-Site': 'same-origin', Origin: 'null' }))).toBe(true);
        expect(isSameOriginRequest(request({ 'Sec-Fetch-Site': 'same-site', Origin: 'https://blog.shop.example' }))).toBe(false);
        expect(isSameOriginRequest(request({ 'Sec-Fetch-Site': 'cross-site' }))).toBe(false);
        expect(isSameOriginRequest(request({ Origin: 'https://shop.example' }))).toBe(true);
        expect(isSameOriginRequest(request({ Origin: 'null' }))).toBe(false);
        expect(isSameOriginRequest(request({}))).toBe(true);
    });
});
