import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { Server, Service, State } from '../src/shared/decorators';
import { ServiceScope } from '../src/shared/service-scope';
import { startDevelopmentTrace, createDevelopmentNavigationTrace, type DevelopmentTraceSession, type DevelopmentServiceRpcEvent } from '../src/shared/development-trace';

@Service() class Counter {
    @State() count = 0;
    @Server() edit(_argument?: unknown) { return 'server'; }
    @Server({ timeout: 10 }) slow() { return 'server'; }
}
const scopes: ServiceScope[] = [];
let session: DevelopmentTraceSession | undefined;
afterEach(async () => { session?.stop(); session = undefined; await Promise.all(scopes.splice(0).map(scope => scope.disposeAsync())); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function service() {
    const scope = new ServiceScope(undefined, [Counter], { ownerRouteId: 'private-layout', scopeKey: 'private-scope' }); scopes.push(scope);
    return scope.resolveDeclared(Counter) as any;
}
const events = () => session!.snapshot().events.filter((event): event is DevelopmentServiceRpcEvent => event.kind === 'service-rpc');
function response() {
    return new Response(JSON.stringify({ _cossack_return: 'private-result', _cossack_service_state: { count: 7 } }), { headers: { 'Content-Type': 'application/json' } });
}
it('joins service request/response/state/completion to the shared timeline without component identities or values', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response())); session = startDevelopmentTrace();
    createDevelopmentNavigationTrace(1)!.record({ phase: 'start', navigationType: 'push' });
    const target = service(); expect(await target.edit('private-input')).toBe('private-result'); expect(target.count).toBe(7);
    expect(events().map(event => event.phase)).toEqual(['start', 'response', 'state-reconciled', 'finish']);
    expect(events().at(-1)?.outcome).toBe('succeeded'); expect(new Set(events().map(event => event.callId)).size).toBe(1);
    const requestId = new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get('X-Cossack-Request-Id');
    expect(events().every(event => event.requestId === requestId)).toBe(true);
    expect(session.snapshot().events.map(event => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(session.snapshot().components.entries).toEqual([]);
    expect(JSON.stringify(session.snapshot())).not.toMatch(/private-input|private-result|private-layout|private-scope|componentId|count/);
    await target.edit(); await service().edit();
    const starts = events().filter(event => event.phase === 'start');
    expect(starts[1].serviceId).toBe(starts[0].serviceId); expect(starts[2].serviceId).not.toBe(starts[0].serviceId);
});
it.each(['cancel', 'timeout'] as const)('records one %s terminal even when the request ignores abort', async ending => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    session = startDevelopmentTrace(); const target = service(), call = ending === 'timeout' ? target.slow() : target.edit();
    if (ending === 'cancel') { await call.cancel(); await call.cancel(); }
    await expect(call).rejects.toMatchObject({ code: ending === 'timeout' ? 'COSSACK_RPC_TIMEOUT' : 'COSSACK_RPC_CANCELLED' });
    expect(events().map(event => [event.phase, event.outcome])).toEqual([['start', null], ['finish', ending === 'timeout' ? 'timeout' : 'cancelled']]);
});
it('records serialization failure before dispatch and rejects private response IDs from evidence', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"private-error"}', { status: 500, headers: { 'X-Cossack-Request-Id': 'private-id' } })));
    session = startDevelopmentTrace(); const target = service();
    await expect(target.edit(new Map())).rejects.toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED' });
    expect(fetch).not.toHaveBeenCalled(); expect(events().at(-1)?.outcome).toBe('failed');
    await expect(target.edit()).rejects.toBeDefined();
    expect(events().at(-1)).toMatchObject({ requestId: null, outcome: 'failed' });
    expect(JSON.stringify(session.snapshot())).not.toMatch(/private-id|private-error/);
});
it('does not move an in-flight service call into a replacement capture', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const first = startDevelopmentTrace(); const call = service().edit(); session = startDevelopmentTrace();
    finish(response()); await call;
    expect(first.snapshot().events.map(event => event.phase)).toEqual(['start']); expect(session.snapshot().events).toEqual([]);
});

it.each(['done', 'cancel'] as const)('captures stream reconciliation and %s, including a frame-only response ID', async ending => {
    const wireId = crypto.randomUUID();
    let writer!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'application/x-cossack-rpc+ndjson' } })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    session = startDevelopmentTrace(); const target = service(), call = target.edit(), iterator = call[Symbol.asyncIterator]();
    writer.enqueue(new TextEncoder().encode(JSON.stringify({ v: 1, type: 'yield', requestId: wireId, state: { count: 2 }, value: 'private-yield' }) + '\n'));
    expect(await iterator.next()).toEqual({ done: false, value: 'private-yield' }); expect(target.count).toBe(2);
    expect(events().at(-1)).toMatchObject({ phase: 'state-reconciled', requestId: wireId });
    if (ending === 'done') {
        writer.enqueue(new TextEncoder().encode(JSON.stringify({ v: 1, type: 'done', requestId: wireId, state: { count: 9 }, value: 'private-result' }) + '\n')); writer.close();
        expect(await iterator.next()).toEqual({ done: true, value: 'private-result' }); expect(target.count).toBe(9);
    } else { await call.cancel(); await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED', requestId: wireId }); }
    expect(events().filter(event => event.phase === 'finish')).toHaveLength(1);
    expect(events().at(-1)).toMatchObject({ requestId: wireId, outcome: ending === 'done' ? 'succeeded' : 'cancelled' });
    expect(JSON.stringify(session.snapshot())).not.toMatch(/private-yield|private-result/);
});
