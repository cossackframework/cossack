import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { registry } = vi.hoisted(() => ({ registry: { pages: {} as Record<string, unknown>, layouts: {}, loadings: {} } }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

// Production manifest behaviour (the manifest and CSS come from ASSETS).
beforeAll(() => { vi.stubEnv('DEV', false); });
afterAll(() => { vi.unstubAllEnvs(); });

/** A fresh router module: the inlining decision is cached per isolate (module instance). */
async function freshApp() {
    vi.resetModules();
    const { Cossack, Page } = await import('@cossackframework/core');
    const { html } = await import('@cossackframework/renderer');
    @Page({ transport: 'http' })
    class Home extends Cossack {
        render() { return html`<p>home</p>`; }
    }
    registry.pages['/src/pages/index.ts'] = { default: Home };
    const { createApp } = await import('../src/router');
    return createApp();
}

type CssReply = () => Response | Promise<Response>;

function assets(css: CssReply | undefined) {
    const cssFetches = vi.fn();
    const env = {
        ASSETS: {
            async fetch(request: Request) {
                const { pathname } = new URL(request.url);
                if (pathname === '/cossack-manifest.json') {
                    return Response.json({ 'src/client/entry-client.ts': css ? { file: 'assets/entry.js', css: ['assets/entry.css'] } : { file: 'assets/entry.js' } });
                }
                if (pathname === '/assets/entry.css') { cssFetches(); return css!(); }
                return new Response('missing', { status: 404 });
            },
        },
    };
    return { env, cssFetches };
}

async function render(app: Awaited<ReturnType<typeof freshApp>>, env: unknown, requests = 3) {
    const pages: string[] = [];
    for (let i = 0; i < requests; i++) {
        const response = await app.request('/', {}, env as any);
        expect(response.status).toBe(200);
        pages.push(await response.text());
    }
    return pages;
}

// Each case re-imports the router graph, which is slow under a loaded parallel run.
describe('inline CSS cache', { timeout: 60_000 }, () => {
    it('caches the decision not to inline an oversized stylesheet', async () => {
        const { env, cssFetches } = assets(() => new Response(`.a{color:red}`.repeat(4000)));
        for (const markup of await render(await freshApp(), env)) {
            expect(markup).toMatch(/<link rel="?stylesheet"? href="?\/assets\/entry\.css/);
            expect(markup).not.toContain('.a{color:red}');
        }
        expect(cssFetches).toHaveBeenCalledTimes(1);
    });

    it('caches the decision when the stylesheet is missing, and releases the failed body', async () => {
        const cancelled = vi.fn();
        const { env, cssFetches } = assets(() => new Response(new ReadableStream({ cancel: cancelled }), { status: 404 }));
        for (const markup of await render(await freshApp(), env)) {
            expect(markup).toMatch(/<link rel="?stylesheet"? href="?\/assets\/entry\.css/);
            expect(markup).not.toContain('<style>');
        }
        expect(cssFetches).toHaveBeenCalledTimes(1);
        expect(cancelled).toHaveBeenCalledTimes(1);
    });

    it('caches the decision when reading the stylesheet fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { env, cssFetches } = assets(() => { throw new Error('assets unavailable'); });
        for (const markup of await render(await freshApp(), env)) expect(markup).not.toContain('<style>');
        expect(cssFetches).toHaveBeenCalledTimes(1);
        vi.restoreAllMocks();
    });

    it('reads a small stylesheet once and inlines the cached text on every request', async () => {
        const { env, cssFetches } = assets(() => new Response('.small{color:blue}'));
        for (const markup of await render(await freshApp(), env)) expect(markup).toContain('<style>.small{color:blue}</style>');
        expect(cssFetches).toHaveBeenCalledTimes(1);
    });

    it('never fetches CSS when the client entry has none', async () => {
        const { env, cssFetches } = assets(undefined);
        await render(await freshApp(), env);
        expect(cssFetches).not.toHaveBeenCalled();
    });
});
