// @vitest-environment node
import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { CossackDurableObject } from '../src/shared/CossackDurableObject';
import { Server, State, Page } from '../src/shared/decorators';
import { createRpcCall, rpcCancellations } from '../src/shared/rpc-stream';
vi.mock('../src/shared/environment', () => ({ isServer: true }));
function gate() { let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); return { wait, release }; }
const NativeResponse = globalThis.Response;
class UpgradeResponse extends NativeResponse {
    private upgraded: boolean;
    constructor(body?: BodyInit | null, init: ResponseInit = {}) { super(body, { ...init, status: init.status === 101 ? 200 : init.status }); this.upgraded = init.status === 101; }
    override get status() { return this.upgraded ? 101 : super.status; }
}
function socket() { return { readyState: 1, send: vi.fn(), close: vi.fn(), serializeAttachment: vi.fn(), deserializeAttachment: () => ({ channel: 'global', request: { url: 'https://fixture.test/ws/owner', headers: [], params: {} } }) }; }
function objectFixture(Component: new () => Cossack, restored = false) {
    vi.stubGlobal('WebSocketRequestResponsePair', class {});
    vi.stubGlobal('WebSocketPair', class { 0 = socket(); 1 = socket(); });
    vi.stubGlobal('Response', UpgradeResponse);
    const values = new Map<string, unknown>(restored ? Object.entries({ stateful: true, componentPath: '/src/pages/live/index.ts', url: '/live', params: {}, componentState: { public: { count: 37 } } }) : []);
    const peers: unknown[] = [];
    const state = { storage: { get: vi.fn(async (key: string | string[]) => Array.isArray(key) ? new Map(key.map(item => [item, values.get(item)])) : values.get(key)), put: vi.fn(async (key: string | Record<string, unknown>, value?: unknown) => { if (typeof key === 'string') values.set(key, value); else for (const [name, item] of Object.entries(key)) values.set(name, item); }) }, setWebSocketAutoResponse: vi.fn(), getWebSockets: () => peers, acceptWebSocket: (peer: unknown) => { peers.push(peer); }, waitUntil: vi.fn() };
    class FixtureObject extends CossackDurableObject { registryReads = 0; async getComponentRegistry() { this.registryReads++; return new Map([['/src/pages/live/index.ts', Component]]); } }
    return { object: new FixtureObject(state as unknown as DurableObjectState, { COSSACK_OBJECT: { idFromName: () => ({ toString: () => 'fixture-owner' }) } }), state, values, peers };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('coalesces overlapping restored actions into one fully restored component owner', async () => {
    const bootstrap = gate(); let instances = 0, gets = 0, inits = 0;
    @Page({ transport: 'durable-object', stateful: true })
    class Live extends Cossack { @State() count = 0; constructor() { super(); instances++; } async get() { gets++; await bootstrap.wait; } async init() { inits++; } @Server() increment() { return ++this.count; } }
    const f = objectFixture(Live, true), first = socket(), second = socket();
    const a = f.object.webSocketMessage(first as unknown as WebSocket, JSON.stringify({ type: 'action', requestId: 'first', action: 'increment', payload: [] }));
    await vi.waitFor(() => expect(gets).toBe(1));
    const b = f.object.webSocketMessage(second as unknown as WebSocket, JSON.stringify({ type: 'action', requestId: 'second', action: 'increment', payload: [] }));
    const state = f.object.fetch(new Request('https://fixture.test/state?componentPath=ignored&url=/forged'));
    try { await Promise.resolve(); await Promise.resolve(); expect(f.object.registryReads).toBe(1); }
    finally { bootstrap.release(); await Promise.all([a, b]); }
    expect((await (await state).json() as { public: { count: number } }).public.count).toBeGreaterThanOrEqual(37);
    expect(instances).toBe(1); expect(gets).toBe(1); expect(inits).toBe(0);
    const terminal = [...first.send.mock.calls, ...second.send.mock.calls].map(([data]) => JSON.parse(data)).filter(frame => frame.type === 'done');
    expect(terminal.map(frame => frame.value).sort()).toEqual([38, 39]); expect(new Set(terminal.map(frame => frame.requestId))).toEqual(new Set(['first', 'second']));
});
it('waits for fresh initialization before accepting any concurrent peer or state snapshot', async () => {
    const initialization = gate(); let inits = 0;
    @Page({ transport: 'durable-object', stateful: true })
    class Live extends Cossack { @State() count = 0; async init() { inits++; await initialization.wait; this.count = 91; } }
    const f = objectFixture(Live);
    const request = () => new Request('https://fixture.test/global?pathname=/live&params={}', { headers: { 'X-Component-Path': '/src/pages/live/index.ts' } });
    const a = f.object.fetch(request()); await vi.waitFor(() => expect(inits).toBe(1));
    const b = f.object.fetch(request());
    try { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); expect(f.peers).toHaveLength(0); }
    finally { initialization.release(); await Promise.all([a, b]); }
    expect(inits).toBe(1); expect(f.peers).toHaveLength(2);
    const frames = f.peers.flatMap(peer => (peer as ReturnType<typeof socket>).send.mock.calls.map(([data]) => JSON.parse(data)));
    expect(frames.filter(frame => frame.type === 'state-update').map(frame => frame.state.count)).toEqual([91, 91]);
});
it('restores persisted state quietly, without a redundant broadcast or storage write', async () => {
    const seen: number[] = [];
    @Page({ transport: 'durable-object', stateful: true })
    class Live extends Cossack {
        @State() count = 0;
        @Server() read() { seen.push(this.count); return this.count; }
    }
    const f = objectFixture(Live, true);
    const peer = socket();
    f.peers.push(peer);
    await f.object.webSocketMessage(socket() as unknown as WebSocket, JSON.stringify({ type: 'action', requestId: 'read', action: 'read', payload: [] }));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(seen).toEqual([37]);
    expect(f.state.storage.put).not.toHaveBeenCalled();
    expect(peer.send.mock.calls.map(([data]) => JSON.parse(data)).filter(frame => frame.type === 'state-update')).toEqual([]);
});
it('cleans one failed shared restoration and permits a subsequent complete retry', async () => {
    const restore = gate(); let fail = true, gets = 0, cleanup = 0;
    @Page({ transport: 'durable-object', stateful: true })
    class Live extends Cossack { @State() count = 0; async get() { gets++; await restore.wait; if (fail) throw new Error('Private bootstrap failure'); } onCleanup() { cleanup++; } @Server() read() { return this.count; } }
    const f = objectFixture(Live, true);
    const send = (id: string) => f.object.webSocketMessage(socket() as unknown as WebSocket, JSON.stringify({ type: 'action', requestId: id, action: 'read', payload: [] }));
    const a = send('first'), b = send('second'); const results = Promise.allSettled([a, b]); await vi.waitFor(() => expect(gets).toBeGreaterThan(0)); restore.release();
    expect((await results).map(result => result.status)).toEqual(['rejected', 'rejected']); expect(gets).toBe(1); expect(cleanup).toBe(1); expect(f.object.componentInstance).toBeUndefined();
    fail = false; await send('retry'); expect(gets).toBe(2); expect(f.object.componentInstance?.getInitialState().public.count).toBe(37);
});
it.each(['init', 'persistence'] as const)('keeps failed fresh %s unpublished, cleans once, and retries', async phase => {
    const blocked = gate(); let inits = 0, cleanup = 0, fail = true;
    @Page({ transport: 'durable-object', stateful: true })
    class Live extends Cossack {
        @State() count = 0;
        async init() { inits++; if (phase === 'init' && fail) { await blocked.wait; throw new Error('Private initialization failure'); } this.count = 91; }
        onCleanup() { cleanup++; }
    }
    const f = objectFixture(Live);
    const originalPut = f.state.storage.put.getMockImplementation()!;
    if (phase === 'persistence') f.state.storage.put.mockImplementation(async (key, value) => {
        if (fail) { await blocked.wait; throw new Error('Private persistence failure'); }
        await originalPut(key, value);
    });
    const request = () => new Request('https://fixture.test/global?pathname=/live&params={}', { headers: { 'X-Component-Path': '/src/pages/live/index.ts' } });
    const first = f.object.fetch(request());
    await vi.waitFor(() => expect(inits).toBe(1));
    if (phase === 'persistence') await vi.waitFor(() => expect(f.state.storage.put).toHaveBeenCalled());
    const second = f.object.fetch(request()); const results = Promise.allSettled([first, second]);
    await Promise.resolve(); await Promise.resolve();
    expect(f.object.componentInstance).toBeUndefined(); expect(f.peers).toHaveLength(0);
    blocked.release(); expect((await results).map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(cleanup).toBe(1); expect(inits).toBe(1); expect(f.object.componentInstance).toBeUndefined(); expect(f.peers).toHaveLength(0);
    fail = false; expect((await f.object.fetch(request())).status).toBe(101);
    expect(inits).toBe(2); expect(cleanup).toBe(1); expect(f.peers).toHaveLength(1);
    expect(f.object.componentInstance?.getInitialState().public.count).toBe(91);
});
it('coalesces stateless first joins and disposes one idle owner before overlapping replacements', async () => {
    const firstInit = gate(), replacementInit = gate(); let inits = 0, cleanup = 0;
    @Page({ transport: 'durable-object', stateful: false })
    class Live extends Cossack {
        @State() count = 0;
        async init() { const attempt = ++inits; await (attempt === 1 ? firstInit : replacementInit).wait; this.count = attempt; }
        onCleanup() { cleanup++; }
    }
    const f = objectFixture(Live);
    const request = () => new Request('https://fixture.test/global?pathname=/live&params={}', { headers: { 'X-Component-Path': '/src/pages/live/index.ts' } });
    const first = f.object.fetch(request()); await vi.waitFor(() => expect(inits).toBe(1));
    const second = f.object.fetch(request()); firstInit.release(); await Promise.all([first, second]);
    expect(inits).toBe(1); expect(cleanup).toBe(0); expect(f.peers).toHaveLength(2);
    f.peers.splice(0); // Simulate the platform's peer list after both sockets retire.
    const replacement = f.object.fetch(request()); await vi.waitFor(() => expect(inits).toBe(2));
    const overlapping = f.object.fetch(request()); await Promise.resolve(); await Promise.resolve();
    expect(cleanup).toBe(1); expect(f.peers).toHaveLength(0); expect(f.object.componentInstance).toBeUndefined();
    replacementInit.release(); await Promise.all([replacement, overlapping]);
    expect(inits).toBe(2); expect(cleanup).toBe(1); expect(f.peers).toHaveLength(2);
    expect(f.object.componentInstance?.getInitialState().public.count).toBe(2);
});
it('shares duplicate completion consumers while rejecting a second iterator without another mutation', async () => {
    const operation = gate(); let mutations = 0, cleanup = 0;
    const call = createRpcCall((async function* () { mutations++; try { yield 'started'; await operation.wait; return 'done'; } finally { cleanup++; } })(), () => {});
    const iterator = call[Symbol.asyncIterator](); expect(await iterator.next()).toEqual({ done: false, value: 'started' });
    expect(() => call[Symbol.asyncIterator]()).toThrow(expect.objectContaining({ code: 'COSSACK_RPC_ALREADY_CONSUMED' }));
    const first = Promise.resolve(call), second = Promise.resolve(call); const terminal = iterator.next(); operation.release();
    expect(await terminal).toEqual({ done: true, value: 'done' }); expect(await Promise.all([first, second])).toEqual(['done', 'done']); expect(mutations).toBe(1); expect(cleanup).toBe(1);
});
it('coalesces repeated cancellation and closes the parked generator once', async () => {
    let mutations = 0, cleanup = 0; const abort = vi.fn();
    const call = createRpcCall((async function* () { mutations++; try { yield 'started'; return 'done'; } finally { cleanup++; } })(), abort);
    const iterator = call[Symbol.asyncIterator](); await iterator.next();
    const rejection = expect(Promise.resolve(call)).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
    await Promise.all([call.cancel(), call.cancel()]); await rejection; expect(abort).toHaveBeenCalledOnce(); expect(mutations).toBe(1); expect(cleanup).toBe(1);
});

it.each([
    { code: 1000, clean: true, expected: 1000, reason: 'finished' },
    { code: 4001, clean: false, expected: 4001, reason: 'finished' },
    { code: 1005, clean: true, expected: 1000, reason: '' },
    { code: 1006, clean: false, expected: 1011, reason: '' },
    { code: 1015, clean: false, expected: 1011, reason: '' },
])('acknowledges close code $code with wire code $expected and retires RPC ownership', async ({ code, clean, expected, reason }) => {
    @Page({ transport: 'durable-object', stateful: true }) class Live extends Cossack {}
    const f = objectFixture(Live);
    await f.object.fetch(new Request('https://fixture.test/global?pathname=/live&params={}', { headers: { 'X-Component-Path': '/src/pages/live/index.ts' } }));
    const peer = f.peers[0] as ReturnType<typeof socket>, ws = peer as unknown as WebSocket;
    const cancel = vi.fn(); rpcCancellations(ws).set('pending', cancel);
    const retire = vi.spyOn(f.object.runtime!, 'retireClient');
    await f.object.webSocketClose(ws, code, 'finished', clean);
    expect(peer.close).toHaveBeenCalledExactlyOnceWith(expected, reason);
    expect(cancel).toHaveBeenCalledOnce(); expect(rpcCancellations(ws).size).toBe(0);
    expect(retire).toHaveBeenCalledExactlyOnceWith(ws);
});
it('retires a terminal socket and cancels its owned RPC even when reciprocal close throws', async () => {
    @Page({ transport: 'durable-object', stateful: true }) class Live extends Cossack {}
    const f = objectFixture(Live);
    await f.object.fetch(new Request('https://fixture.test/global?pathname=/live&params={}', { headers: { 'X-Component-Path': '/src/pages/live/index.ts' } }));
    const peer = f.peers[0] as ReturnType<typeof socket>, ws = peer as unknown as WebSocket;
    peer.close.mockImplementation(() => { throw new Error('Terminal private socket error'); });
    const cancel = vi.fn(); rpcCancellations(ws).set('pending', cancel);
    const retire = vi.spyOn(f.object.runtime!, 'retireClient');
    await expect(f.object.webSocketClose(ws, 1000, '', true)).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce(); expect(rpcCancellations(ws).size).toBe(0);
    expect(retire).toHaveBeenCalledExactlyOnceWith(ws);
});
it('runs a fresh create after a concurrent restore instead of adopting the restore promise', async () => {
    const restore = gate(); let inits = 0, gets = 0, parked = false;
    @Page({ transport: 'durable-object', stateful: true })
    class Live extends Cossack { @State() count = 0; async init() { inits++; } }
    const f = objectFixture(Live);
    const originalGet = f.state.storage.get.getMockImplementation()!;
    // The second restore (from another socket's message) parks on the gate.
    f.state.storage.get.mockImplementation(async (key: string | string[]) => { if (Array.isArray(key) && ++gets === 2) await restore.wait; return originalGet(key); });
    const object = f.object as any;
    const ensure = object.ensureComponentInstance.bind(object);
    let other: Promise<unknown> | undefined;
    // Interleave: right after this join's restore check, another peer's message
    // starts its own restore before this join reaches its create operation.
    object.ensureComponentInstance = async () => {
        await ensure();
        if (!other) { other = f.object.webSocketMessage(socket() as unknown as WebSocket, '{}'); await vi.waitFor(() => expect(gets).toBe(2)); parked = true; }
    };
    const join = f.object.fetch(new Request('https://fixture.test/global?pathname=/live&params={}', { headers: { 'X-Component-Path': '/src/pages/live/index.ts' } }));
    await vi.waitFor(() => expect(parked).toBe(true));
    await new Promise(resolve => setTimeout(resolve, 0)); // the join now waits on the pending restore
    expect(inits).toBe(0);
    restore.release();
    expect((await join).status).toBe(101);
    await other;
    expect(inits).toBe(1); expect(f.peers).toHaveLength(1); expect(f.object.componentInstance).toBeDefined();
});
