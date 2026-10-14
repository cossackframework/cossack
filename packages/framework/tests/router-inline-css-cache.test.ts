import 'reflect-metadata';
import { afterAll, describe, expect, it, vi } from 'vitest';
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
registry.pages['/src/pages/index.ts'] = { default: Home };

// Production manifest behaviour (the manifest and CSS come from ASSETS).
vi.stubEnv('DEV', false);
const { createApp } = await import('../src/router');
afterAll(() => { vi.unstubAllEnvs(); });

describe('inline CSS cache', () => {
    it('caches the decision not to inline an oversized stylesheet', async () => {
        const cssFetches = vi.fn();
        const env = {
            ASSETS: {
                async fetch(request: Request) {
                    const { pathname } = new URL(request.url);
                    if (pathname === '/cossack-manifest.json') {
                        return Response.json({ 'src/client/entry-client.ts': { file: 'assets/entry.js', css: ['assets/entry.css'] } });
                    }
                    if (pathname === '/assets/entry.css') {
                        cssFetches();
                        return new Response(`.a{color:red}`.repeat(4000));
                    }
                    return new Response('missing', { status: 404 });
                },
            },
        };
        const app = createApp();
        for (let i = 0; i < 3; i++) {
            const response = await app.request('/', {}, env as any);
            expect(response.status).toBe(200);
            const markup = await response.text();
            expect(markup).toMatch(/<link rel="?stylesheet"? href="?\/assets\/entry\.css/);
            expect(markup).not.toContain('.a{color:red}');
        }
        expect(cssFetches).toHaveBeenCalledTimes(1);
    });
});
