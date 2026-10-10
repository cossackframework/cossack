import { Context, type MiddlewareHandler } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocale, getRequestContext, RESPONSE_HEADER_STATE_KEY } from '@cossackframework/core';
import { captureRealtimeIdentity, revalidateRealtimeIdentity, snapshotRealtimeRequest, withRealtimeAuthorization } from '../src/realtime-context';
import { binding, config, requireEnv, requireConfigVariable } from '../src/config';

const { globalMiddlewares, requirements, factories } = vi.hoisted(() => ({ requirements: {} as Record<string, any>, factories: {} as Record<string, any>, globalMiddlewares: [] as MiddlewareHandler[] }));
factories.realtime = ({ env }: { env: (key: string) => string }) => ({ marker: env('marker') });
vi.mock('virtual:cossack-middlewares', () => ({ default: globalMiddlewares }));
vi.mock('virtual:cossack-config', () => ({ requirements, environment: null, default: factories }));
afterEach(() => { globalMiddlewares.length = 0; for (const key of Object.keys(requirements)) delete requirements[key]; for (const key of Object.keys(factories)) delete factories[key]; factories.realtime = ({ env }: { env: (key: string) => string }) => ({ marker: env('marker') }); });

const identity = { version: 1 as const, provider: 'fixture.session', data: { reference: 'opaque', fingerprint: 'digest' } };
const context = () => new Context(new Request('http://localhost/sse/route?scopeKey=team', { headers: {
    cookie: 'session=PRIVATE_BEARER', authorization: 'Bearer PRIVATE_TOKEN', 'x-user-data': 'PRIVATE_ASSERTION',
    'x-api-key': 'PRIVATE_KEY', 'accept-language': 'en', origin: 'http://localhost',
} }), { env: { marker: 'binding' } });

describe('realtime authorization context', () => {
    it('captures a detached bounded descriptor without invoking accessors', async () => {
        const c = context(); c.set('user', { id: 'owner' });
        const supplied = structuredClone(identity); c.set('cossack.captureRealtimeIdentity', async () => supplied);
        const captured = await captureRealtimeIdentity(c); supplied.data.reference = 'changed';
        expect(captured).toEqual(identity);
        const getter = vi.fn(() => 'PRIVATE');
        c.set('cossack.captureRealtimeIdentity', async () => ({ ...identity, data: { get token() { return getter(); } } }));
        await expect(captureRealtimeIdentity(c)).rejects.toThrow('accessors'); expect(getter).not.toHaveBeenCalled();
        for (const data of ['x'.repeat(1025), Array(129).fill(0), { value: NaN }, new Date(), Array(2), { constructor: 'reserved' }]) {
            c.set('cossack.captureRealtimeIdentity', async () => ({ ...identity, data }));
            await expect(captureRealtimeIdentity(c)).rejects.toThrow();
        }
    });

    it('requires a provider and a stable user ID for authenticated subscriptions', async () => {
        const c = context(); expect(await captureRealtimeIdentity(c)).toBeNull();
        c.set('user', { id: 'owner' }); await expect(captureRealtimeIdentity(c)).rejects.toThrow('revalidation provider');
        c.set('user', {}); await expect(captureRealtimeIdentity(c)).rejects.toThrow('user ID');
    });

    it('runs fresh global and inherited middleware scopes, then awaits their cleanup', async () => {
        const original = context(); original.set('user', { id: 'stale' });
        let opened = 0; let closed = 0; let active = 0;
        const contexts: Context[] = [];
        globalMiddlewares.push(async (c, next) => {
            opened++; active++; contexts.push(c);
            expect(getRequestContext()).toBe(c); expect(c.env).toBe(original.env);
            expect(binding('marker')).toBe('binding'); expect(config('realtime.marker')).toBe('binding');
            expect(getLocale()).toBe('fr');
            expect(c.req.param('room')).toBe('decoded/room');
            for (const header of ['cookie', 'authorization', 'x-user-data', 'x-api-key']) expect(c.req.header(header)).toBeUndefined();
            expect(c.req.header('accept-language')).toBe('en');
            expect(c.get(RESPONSE_HEADER_STATE_KEY)).toEqual({ committed: true });
            const descriptor = c.get('cossack.realtimeIdentity'); expect(descriptor).toEqual(identity);
            descriptor.data.reference = 'mutated-in-this-scope';
            c.set('user', { id: 'fresh' });
            try { await next(); } finally { active--; closed++; }
        });
        const guard: MiddlewareHandler = async (c, next) => {
            expect(c.get('user')).toEqual({ id: 'fresh' }); await next();
        };
        const check = vi.fn(async (c: Context) => { expect(active).toBe(1); expect(getRequestContext()).toBe(c); return true; });
        for (let i = 0; i < 2; i++) expect(await revalidateRealtimeIdentity(original, { room: 'decoded/room' }, identity, [guard], check, 'fr')).toBe(true);
        expect({ opened, closed, active }).toEqual({ opened: 2, closed: 2, active: 0 });
        expect(contexts[0]).not.toBe(contexts[1]); expect(original.get('user')).toEqual({ id: 'stale' });
        expect(identity.data.reference).toBe('opaque');
    });

    it('fails closed on inherited denial, storage failure, cleanup failure or header writes', async () => {
        const check = vi.fn(() => true);
        const guards: MiddlewareHandler[] = [
            async c => c.json({ denied: true }, 403),
            async () => { throw new Error('PRIVATE_STORAGE_FAILURE'); },
            async (_c, next) => { await next(); throw new Error('PRIVATE_CLEANUP_FAILURE'); },
            async (c, next) => { await next(); c.header('Set-Cookie', 'PRIVATE_COOKIE'); },
            async (_c, next) => { await next(); await next(); },
        ];
        for (const guard of guards) expect(await revalidateRealtimeIdentity(context(), {}, identity, [guard], check)).toBe(false);
    });

    it('keeps guest rechecks explicit without replaying authentication headers', async () => {
        const original = context();
        globalMiddlewares.push(async (c, next) => {
            expect(c.req.header('cookie')).toBeUndefined();
            expect(c.get('cossack.realtimeIdentity')).toEqual({ version: 1, provider: '', data: null }); await next();
        });
        expect(await revalidateRealtimeIdentity(original, {}, null, [], c => !c.get('user'))).toBe(true);
    });

    it('discards ordinary headers from replayed middleware without rejecting the request', async () => {
        globalMiddlewares.push(async (_c, next) => { await next(); _c.header('x-worker-pipeline', 'ran'); });
        expect(await revalidateRealtimeIdentity(context(), {}, null, [], () => true)).toBe(true);
    });

    it('keeps snapshots credential-free and runs protected work before middleware cleanup', async () => {
        const original = context();
        original.set('user', { id: 'old-user' });
        const snapshot = snapshotRealtimeRequest(original, { room: 'alpha' }, 'fr');
        expect(JSON.stringify(snapshot)).not.toContain('PRIVATE');
        let insideMiddleware = false;
        globalMiddlewares.push(async (c, next) => {
            insideMiddleware = true;
            c.set('user', { id: 'fresh-user' });
            await next();
            insideMiddleware = false;
        });
        const operation = vi.fn(async (c: Context) => {
            expect(insideMiddleware).toBe(true);
            expect(getRequestContext()).toBe(c);
            expect(c.get('user')).toEqual({ id: 'fresh-user' });
        });
        const result = await withRealtimeAuthorization(snapshot, identity, [], c => c.get('user')?.id === 'fresh-user', operation);
        expect(result).not.toBeNull();
        expect(operation).toHaveBeenCalledOnce();
        expect(insideMiddleware).toBe(false);
        expect(original.get('user')).toEqual({ id: 'old-user' });
    });
});

it('prepares required helpers and typed declarations in each realtime replay scope', async () => {
    requirements.realtime = { variables: { marker: { type: 'string' }, PORT: { type: 'number', coerce: true } } };
    factories.realtime = () => ({ marker: requireEnv('marker'), port: requireConfigVariable('PORT', 'number') });
    const original = context(); original.env.PORT = '81'; original.set('cossack.configContext', { runtime: 'node', environment: 'staging' });
    const snapshot = snapshotRealtimeRequest(original, {});
    expect(snapshot.configContext).toEqual({ runtime: 'node', environment: 'staging' });
    const operation = vi.fn(() => { expect(config('realtime.port')).toBe(81); return requireEnv('marker'); });
    expect(await withRealtimeAuthorization(snapshot, null, [], () => true, operation)).toMatchObject({ value: 'binding' });
    expect(operation).toHaveBeenCalledOnce(); expect(binding('marker')).toBeUndefined();
});
it('fails realtime replay before factories, middleware, authorization or operations', async () => {
    const factory = vi.fn(() => ({})); factories.realtime = factory;
    requirements.realtime = { bindings: { DB: { kind: 'd1', runtimes: ['node'] } } };
    const original = context(); original.set('cossack.configContext', { runtime: 'node' });
    const middleware = vi.fn(async (_c, next) => { await next(); });
    const check = vi.fn(() => true); const operation = vi.fn();
    expect(await withRealtimeAuthorization(snapshotRealtimeRequest(original, {}), null, [middleware], check, operation)).toBeNull();
    expect(factory).not.toHaveBeenCalled(); expect(middleware).not.toHaveBeenCalled(); expect(check).not.toHaveBeenCalled(); expect(operation).not.toHaveBeenCalled();
});
