import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack, Page, Server, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { computeRouteIds } from '../src/route-ids';

const { registry } = vi.hoisted(() => ({ registry: { pages: {} as Record<string, any>, layouts: {}, loadings: {} } }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

const KIB = 1024;
@Page({ transport: 'http' })
class RecordsPage extends Cossack {
    @State() note = '';
    @Server() records(bytes: number) { return 'x'.repeat(bytes); }
    @Server({ maxResponseBytes: 4 * KIB * KIB }) archive(bytes: number) { return 'x'.repeat(bytes); }
    /** The state a call changes counts too. */
    @Server() fill(bytes: number) { this.note = 'x'.repeat(bytes); }
    render() { return html`records`; }
}
const path = '/src/pages/records/index.ts';
registry.pages[path] = { default: RecordsPage };
const routeId = computeRouteIds([path], []).routePathToIdMap.get(path)!;
const { createApp } = await import('../src/router');

const call = (app: ReturnType<typeof createApp>, action: string, bytes: number) => app.request('/crpc', {
    method: 'POST', headers: { origin: 'http://localhost', 'Content-Type': 'application/json' },
    body: JSON.stringify({ componentRouteId: routeId, scopeKey: 'user:anonymous', action, state: { note: '' }, payload: [bytes] }),
}, {} as any);

describe('server method response limit', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('fails a response over 1 MiB on the server, logs it with its size, and sends nothing of it', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const app = createApp();
        const response = await call(app, 'records', 2 * KIB * KIB);
        expect(response.status).toBe(500);
        const body = await response.json() as { code: string; error: string };
        expect(body.code).toBe('COSSACK_RPC_RESPONSE_TOO_LARGE');
        expect(body.error).toContain("'records'");
        expect(logged).toHaveBeenCalledWith(expect.objectContaining({ event: 'cossack.rpc.failure', action: 'records', stage: 'response',
            code: 'COSSACK_RPC_RESPONSE_TOO_LARGE', limitBytes: KIB * KIB, bytes: expect.any(Number) }));
        // State a method changes counts toward the limit.
        expect((await call(app, 'fill', 2 * KIB * KIB)).status).toBe(500);
        const small = await call(app, 'records', 10);
        expect(small.status).toBe(200);
        expect(small.headers.get('X-Cossack-Rpc-Limit')).toBeNull();
    });

    it('takes a limit per method and for the application, and tells the browser the limit', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const perMethod = await call(createApp(), 'archive', 2 * KIB * KIB);
        expect(perMethod.status).toBe(200);
        expect(perMethod.headers.get('X-Cossack-Rpc-Limit')).toBe(String(4 * KIB * KIB));
        const app = createApp({ rpc: { maxResponseBytes: 3 * KIB * KIB } });
        const appWide = await call(app, 'records', 2 * KIB * KIB);
        expect(appWide.status).toBe(200);
        expect(appWide.headers.get('X-Cossack-Rpc-Limit')).toBe(String(3 * KIB * KIB));
        expect(() => createApp({ rpc: { maxResponseBytes: 17 * KIB * KIB } })).toThrow(/16 MiB/);
        expect(() => Server({ maxResponseBytes: 0 })).toThrow(/maxResponseBytes/);
    });

    it('warns once in development about a response over half its limit', async () => {
        const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const app = createApp();
        await call(app, 'records', 700 * KIB);
        await call(app, 'records', 700 * KIB);
        const warnings = warned.mock.calls.filter(([message]) => String(message).includes('response limit'));
        expect(warnings).toHaveLength(1);
        expect(String(warnings[0]![0])).toContain("'records'");
    });
});
