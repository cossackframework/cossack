import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const { registry, userMiddleware, appConfig } = vi.hoisted(() => ({
    registry: { pages: {} as Record<string, unknown>, layouts: {}, loadings: {} },
    userMiddleware: vi.fn(async (_c: unknown, next: () => Promise<void>) => { await next(); }),
    appConfig: vi.fn(() => ({ name: 'demo' })),
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [userMiddleware] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: { app: appConfig } }));

@Page({ transport: 'http' })
class Home extends Cossack {
    render() { return html`<p>home</p>`; }
}
registry.pages['/src/pages/index.ts'] = { default: Home };
const { createApp } = await import('../src/router');

function makeEnv() {
    return {
        ASSETS: {
            fetch: vi.fn(async (request: Request) => {
                const { pathname } = new URL(request.url);
                if (pathname === '/assets/x.js') {
                    return new Response('export {}', { headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=31536000, immutable' } });
                }
                return new Response('missing', { status: 404 });
            }),
        },
    };
}

beforeEach(() => { userMiddleware.mockClear(); appConfig.mockClear(); });

describe('static asset fast path', () => {
    it('serves hashed /assets/* files without the global middleware stack', async () => {
        const env = makeEnv();
        const response = await createApp().request('/assets/x.js', {}, env as any);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('export {}');
        expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
        // Security headers that must hold for scripts still apply.
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(userMiddleware).not.toHaveBeenCalled();
        expect(appConfig).not.toHaveBeenCalled();
    });

    it('keeps the full pipeline for missing assets and for page requests', async () => {
        const env = makeEnv();
        const missing = await createApp().request('/assets/missing.js', {}, env as any);
        expect(missing.status).toBe(404);
        expect(userMiddleware).toHaveBeenCalledTimes(1);
        const page = await createApp().request('/', {}, env as any);
        expect(page.status).toBe(200);
        expect(userMiddleware).toHaveBeenCalledTimes(2);
    });

    it('prepares config once per env object', async () => {
        const app = createApp();
        const env = makeEnv();
        await app.request('/', {}, env as any);
        await app.request('/', {}, env as any);
        expect(appConfig).toHaveBeenCalledTimes(1);
        await app.request('/', {}, makeEnv() as any);
        expect(appConfig).toHaveBeenCalledTimes(2);
    });
});
