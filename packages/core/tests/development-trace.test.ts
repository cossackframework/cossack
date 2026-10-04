import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { startDevelopmentTrace, createDevelopmentNavigationTrace, type DevelopmentRpcEvent, type DevelopmentTraceSession } from '../src/shared/development-trace';
import { proxyHttpMethods, proxyServerMethods } from '../src/shared/method-proxy';
import { failPendingSocketCalls, routeSocketFrame } from '../src/shared/transport-connections';

let session: DevelopmentTraceSession | undefined;
const rpcEvents = () => session!.snapshot().events.filter((event): event is DevelopmentRpcEvent => event.kind === 'rpc');
afterEach(() => { session?.stop(); session = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function component(transport: 'http' | 'sse' | 'websocket' = 'http', socket?: any, timeout?: number) {
    const target: any = {
        constructor: class Page {}, __cossack_proxies: new Map(),
        getInitialStateFromWindow: () => ({ componentRouteId: 'private-route', transport, scopeKey: 'secret-scope' }),
        count: 0, getPublicState: () => ({ count: target.count }),
        loading: {}, _optimisticLockedKeys: {}, _optimisticPendingState: {},
        _isOptimisticLocked: () => false, hasMethod: () => false,
        requestUpdate: vi.fn(), setProperty(key: string, value: unknown) { this[key] = value; },
        websockets: new Map(socket ? [['private-provider', socket]] : []), consume: () => undefined,
    };
    if (timeout !== undefined) Reflect.defineMetadata('cossack:server-methods', { run: { timeout } }, target.constructor);
    if (transport === 'websocket') proxyServerMethods(target, [{ name: 'run', channel: 'private-channel', provider: 'private-provider' }]);
    else proxyHttpMethods(target, [{ name: 'run' }]);
    return target;
}
function successfulFetch() {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({ count: 7, _cossack_return: 'private-result' }), {
        headers: { 'Content-Type': 'application/json', 'X-Cossack-Request-Id': new Headers(init.headers).get('X-Cossack-Request-Id')! },
    })));
}

it.each(['http', 'sse'] as const)('correlates actual %s proxy response, state reconciliation and completion without retaining payloads', async transport => {
    session = startDevelopmentTrace(); successfulFetch();
    const target = component(transport);
    expect(await target.run('private-argument')).toBe('private-result');
    expect(target.count).toBe(7);
    const snapshot = session.snapshot();
    expect(snapshot.events.map(event => event.phase)).toEqual(['start', 'response', 'state-reconciled', 'finish']);
    expect(new Set(rpcEvents().map(event => event.callId)).size).toBe(1);
    const requestId = new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get('X-Cossack-Request-Id');
    expect(snapshot.events.filter((event): event is DevelopmentRpcEvent => event.kind === 'rpc').every(event => event.requestId === requestId)).toBe(true);
    expect(rpcEvents().at(-1)?.outcome).toBe('succeeded');
    for (const secret of ['private-route', 'secret-scope', 'private-argument', 'private-result', 'count']) expect(JSON.stringify(snapshot)).not.toContain(secret);
});

it('records exactly one cancellation terminal event even when the fetch producer ignores abort', async () => {
    session = startDevelopmentTrace();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const call = component().run();
    await call.cancel(); await call.cancel();
    await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
    expect(rpcEvents().map(event => [event.phase, event.outcome])).toEqual([['start', null], ['finish', 'cancelled']]);
});

it.each(['done', 'disconnect', 'cancel'] as const)('captures WebSocket %s through real frame dispatch and cleanup', async ending => {
    session = startDevelopmentTrace(); vi.spyOn(console, 'error').mockImplementation(() => {});
    const socket = { readyState: WebSocket.OPEN, send: vi.fn() };
    const target = component('websocket', socket), call = target.run('private-argument');
    const message = JSON.parse(socket.send.mock.calls[0][0]);
    if (ending === 'done') {
        routeSocketFrame(socket, { v: 1, type: 'done', requestId: message.requestId, value: 'private-result', state: { count: 9 } });
        expect(await call).toBe('private-result'); expect(target.count).toBe(9);
    } else if (ending === 'disconnect') {
        failPendingSocketCalls(socket); await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_TRANSPORT_CLOSED' });
    } else { await call.cancel(); await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' }); }
    const events = rpcEvents();
    expect(events.filter(event => event.phase === 'finish')).toHaveLength(1);
    expect(events.at(-1)?.outcome).toBe(ending === 'done' ? 'succeeded' : ending === 'disconnect' ? 'disconnected' : 'cancelled');
    expect(events.every(event => event.requestId === message.requestId)).toBe(true);
    expect(target.loading).toEqual({});
});

it('bounds events, reports dropped history and returns detached snapshots', async () => {
    session = startDevelopmentTrace({ capacity: 3 }); successfulFetch();
    const target = component(); await target.run(); await target.run();
    const snapshot = session.snapshot(); expect(snapshot.events).toHaveLength(3); expect(snapshot.dropped).toBe(5);
    expect(snapshot.events.map(event => event.sequence)).toEqual([6, 7, 8]);
    (snapshot.events[0] as any).phase = 'tampered'; (snapshot.events as any[]).length = 0;
    expect(session.snapshot().events.map(event => event.phase)).toEqual(['response', 'state-reconciled', 'finish']);
});

it('does not move in-flight calls into a replacement capture or stop a newer capture through an older handle', async () => {
    session = startDevelopmentTrace(); const first = session;
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    const call = component().run();
    session = startDevelopmentTrace(); first.stop();
    resolve(new Response(JSON.stringify({ count: 3 }), { headers: { 'Content-Type': 'application/json' } }));
    await call;
    expect(first.snapshot().collecting).toBe(false); expect(first.snapshot().events).toHaveLength(1);
    expect(session.snapshot().collecting).toBe(true); expect(session.snapshot().events).toEqual([]);
    successfulFetch(); await component().run(); expect(session.snapshot().events).toHaveLength(4);
});

it('requires development mode and validates capacity without replacing an active session', () => {
    session = startDevelopmentTrace();
    for (const capacity of [0, 2049, NaN, 1.5]) expect(() => startDevelopmentTrace({ capacity })).toThrow(RangeError);
    expect(session.snapshot().collecting).toBe(true);
    vi.stubEnv('DEV', false);
    expect(() => startDevelopmentTrace()).toThrow(expect.objectContaining({ code: 'COSSACK_DEVTOOLS_DISABLED' }));
});


it('records a deadline as timeout and suppresses non-UUID response identifiers', async () => {
    session = startDevelopmentTrace(); vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    await expect(component('http', undefined, 10).run()).rejects.toMatchObject({ code: 'COSSACK_RPC_TIMEOUT' });
    expect(rpcEvents().at(-1)?.outcome).toBe('timeout');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: {
        'Content-Type': 'application/json', 'X-Cossack-Request-Id': 'private-identifier',
    } })));
    await component().run();
    expect(rpcEvents().at(-1)?.requestId).toBeNull();
    expect(JSON.stringify(session.snapshot())).not.toContain('private-identifier');
});

it('finishes a call rejected before WebSocket dispatch', async () => {
    session = startDevelopmentTrace(); vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(component('websocket').run()).rejects.toMatchObject({ code: 'COSSACK_RPC_TRANSPORT_UNAVAILABLE' });
    expect(rpcEvents().map(event => [event.phase, event.outcome])).toEqual([['start', null], ['finish', 'failed']]);
});


it('orders navigation and RPC phases together and joins prepared instances by opaque component identity', async () => {
    session = startDevelopmentTrace(); successfulFetch();
    const navigation = createDevelopmentNavigationTrace(7)!;
    navigation.record({ phase: 'start', navigationType: 'push' });
    const target = component(); navigation.component(target, 'page');
    await target.run(); navigation.record({ phase: 'finish', outcome: 'completed', committed: true });
    navigation.record({ phase: 'transition', decision: 'animation-skipped' });
    const events = session.snapshot().events;
    expect(events.map(event => event.phase)).toEqual(['start', 'component-prepared', 'start', 'response', 'state-reconciled', 'finish', 'finish']);
    const prepared = events.find(event => event.phase === 'component-prepared')!;
    expect(prepared).toMatchObject({ kind: 'navigation', navigationId: 7, componentId: rpcEvents()[0].componentId, role: 'page' });
    expect(events.map(event => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
});

it('binds navigation ownership at creation and prevents capture replacement from adopting late events', () => {
    const absent = createDevelopmentNavigationTrace(1);
    expect(absent).toBeUndefined();
    session = startDevelopmentTrace(); const oldSession = session;
    const older = createDevelopmentNavigationTrace(2)!; older.record({ phase: 'start', navigationType: 'push' });
    session = startDevelopmentTrace(); older.record({ phase: 'finish', outcome: 'superseded', committed: false });
    older.component({}, 'page');
    expect(oldSession.snapshot().events).toHaveLength(1); expect(session.snapshot().events).toEqual([]);
    createDevelopmentNavigationTrace(null)!.record({ phase: 'invalidate', entries: 3 });
    expect(session.snapshot().events[0]).toMatchObject({ kind: 'navigation', navigationId: null, phase: 'invalidate', entries: 3 });
});

it('copies allowlisted navigation primitives and ignores malformed or private fields', () => {
    session = startDevelopmentTrace(); const trace = createDevelopmentNavigationTrace(1)!;
    trace.record({ phase: 'start', navigationType: 'push', url: '/secret', state: { secret: true } } as any);
    for (const event of [null, { phase: 'cache', decision: 'secret' }, { phase: 'invalidate', entries: Infinity },
        { phase: 'finish', outcome: 'secret', committed: true }, { phase: 'layouts', retained: -1, created: 0, retired: 0, rootReplaced: true }]) {
        trace.record(event as any);
    }
    expect(session.snapshot().events).toHaveLength(1);
    expect(JSON.stringify(session.snapshot())).not.toMatch(/secret|url|state/);
    expect(createDevelopmentNavigationTrace(NaN)).toBeUndefined();
});
