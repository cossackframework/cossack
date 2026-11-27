import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack, Page, Server, State, Store } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { computeRouteIds } from '../src/route-ids';

const { registry } = vi.hoisted(() => ({ registry: { pages: {} as Record<string, any>, layouts: {}, loadings: {} } }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

const KIB = 1024;
const hailFile = () => ({ type: 'FeatureCollection', features: 'x'.repeat(600 * KIB) });

@Page({ transport: 'http' })
class StormPage extends Cossack {
    @State() note = '';
    /** The browser keeps the hail file; calls do not send it back. */
    @State({ send: false }) storm: { type: string; features: string } | null = null;
    @Store({ send: false }) layers = { names: [] as string[] };
    async init() { this.storm = hailFile(); }
    /** Reads only its arguments, and the field it was not sent. */
    @Server() impacted(stormRowId: number, page: number) { return { stormRowId, page, storm: this.storm }; }
    @Server() rename(note: string) { this.note = note; }
    @Server() reload() { this.storm = { type: 'FeatureCollection', features: 'fresh' }; }
    /** Assigns the initial value: the browser still gets it. */
    @Server() clear() { this.storm = null; }
    @Server() addLayer(name: string) { this.layers.names.push(name); }
    render() { return html`storm`; }
}

/** The same state without `send: false`: calls carry it, and SSR warns. */
@Page({ transport: 'http' })
class HeavyPage extends Cossack {
    @State() storm: { type: string; features: string } | null = null;
    async init() { this.storm = hailFile(); }
    @Server() impacted(stormRowId: number) { return stormRowId; }
    render() { return html`heavy`; }
}

const stormPath = '/src/pages/storm/index.ts';
const heavyPath = '/src/pages/heavy/index.ts';
registry.pages[stormPath] = { default: StormPage };
registry.pages[heavyPath] = { default: HeavyPage };
const routeIds = computeRouteIds([stormPath, heavyPath], []).routePathToIdMap;
const { createApp } = await import('../src/router');

type App = ReturnType<typeof createApp>;
const call = (app: App, path: string, action: string, state: Record<string, unknown>, payload: unknown[], headers: Record<string, string> = {}) => {
    const body = JSON.stringify({ componentRouteId: routeIds.get(path), scopeKey: 'user:anonymous', action, state, payload });
    return app.request('/crpc', {
        method: 'POST', headers: { origin: 'http://localhost', 'Content-Type': 'application/json', ...headers }, body,
    }, {} as any);
};

describe('state fields that calls do not send', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('leaves a send: false field at its initial value in the method and out of the reply', async () => {
        const app = createApp();
        // A crafted request that sends the field anyway changes nothing.
        const response = await call(app, stormPath, 'impacted', { note: 'n', storm: { type: 'forged', features: '' } }, [7, 2]);
        expect(response.status).toBe(200);
        const body = await response.json() as Record<string, unknown>;
        expect(body._cossack_return).toEqual({ stormRowId: 7, page: 2, storm: null });
        expect(body.note).toBe('n');
        expect(body).not.toHaveProperty('storm');
        expect(body).not.toHaveProperty('layers');
    });

    it('sends a send: false field back when the method assigns it, even to its initial value', async () => {
        const app = createApp();
        const reloaded = await (await call(app, stormPath, 'reload', { note: '' }, [])).json() as Record<string, unknown>;
        expect(reloaded.storm).toEqual({ type: 'FeatureCollection', features: 'fresh' });
        const cleared = await (await call(app, stormPath, 'clear', { note: '' }, [])).json() as Record<string, unknown>;
        expect(cleared).toHaveProperty('storm', null);
        const layered = await (await call(app, stormPath, 'addLayer', { note: '' }, ['hail'])).json() as Record<string, unknown>;
        expect(layered.layers).toEqual({ names: ['hail'] });
        expect(layered).not.toHaveProperty('storm');
        const renamed = await (await call(app, stormPath, 'rename', { note: '' }, ['Hail 12'])).json() as Record<string, unknown>;
        expect(renamed.note).toBe('Hail 12');
        expect(renamed).not.toHaveProperty('storm');
    });
});

describe('server method request limit', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('refuses a request over 1 MiB with the limit and its option, and logs it', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        const app = createApp();
        const big = { storm: { type: 'FeatureCollection', features: 'x'.repeat(1100 * KIB) } };
        const response = await call(app, heavyPath, 'impacted', big, [1]);
        expect(response.status).toBe(413);
        const body = await response.json() as { code: string; error: string };
        expect(body.code).toBe('COSSACK_RPC_REQUEST_TOO_LARGE');
        expect(body.error).toContain(`${KIB * KIB}-byte limit`);
        expect(body.error).toContain('rpc.maxRequestBytes');
        expect(logged).toHaveBeenCalledWith(expect.objectContaining({ event: 'cossack.rpc.failure', stage: 'request',
            code: 'COSSACK_RPC_REQUEST_TOO_LARGE', route: '/crpc', limitBytes: KIB * KIB }));

        // A declared length is known before reading, so the message and the log line name it.
        const declared = JSON.stringify({ componentRouteId: routeIds.get(heavyPath), action: 'impacted', state: big, payload: [1] });
        const bytes = new TextEncoder().encode(declared).byteLength;
        const sized = await call(app, heavyPath, 'impacted', big, [1], { 'Content-Length': String(bytes) });
        expect(sized.status).toBe(413);
        expect((await sized.json() as { error: string }).error).toContain(`The request of ${bytes} bytes`);
        expect(logged).toHaveBeenLastCalledWith(expect.objectContaining({ bytes, limitBytes: KIB * KIB }));
    });

    it('takes rpc.maxRequestBytes up to 16 MiB', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        // The reply echoes the state, so it needs the larger response limit too.
        const app = createApp({ rpc: { maxRequestBytes: 2 * KIB * KIB, maxResponseBytes: 2 * KIB * KIB } });
        const big = { storm: { type: 'FeatureCollection', features: 'x'.repeat(1100 * KIB) } };
        expect((await call(app, heavyPath, 'impacted', big, [1])).status).toBe(200);
        expect(() => createApp({ rpc: { maxRequestBytes: 17 * KIB * KIB } })).toThrow(/rpc\.maxRequestBytes.*16 MiB/);
        expect(() => createApp({ rpc: { maxRequestBytes: 0 } })).toThrow(/rpc\.maxRequestBytes/);
    });
});

describe('development warning for large call state', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('warns once at SSR about a page whose calls send over half the limit, naming its largest fields', async () => {
        const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const app = createApp();
        expect((await app.request('/heavy')).status).toBe(200);
        expect((await app.request('/heavy')).status).toBe(200);
        const warnings = warned.mock.calls.map(([message]) => String(message)).filter(message => message.includes('request limit'));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(heavyPath);
        expect(warnings[0]).toContain('storm (614 KB)');
        expect(warnings[0]).toContain('@State({ send: false })');
    });

    it('does not count send: false fields', async () => {
        const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const response = await createApp().request('/storm');
        expect(response.status).toBe(200);
        // The browser still gets the field at SSR.
        expect(await response.text()).toContain('"features":"xxxx');
        expect(warned.mock.calls.map(([message]) => String(message)).filter(message => message.includes('request limit'))).toEqual([]);
    });
});
