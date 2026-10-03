import { Context } from 'hono';
import { CossackDurableObject } from '../src/shared/CossackDurableObject';
import { rpcCancellations } from '../src/shared/rpc-stream';
import { afterEach, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { createInstance } from '../src/shared/container';
import { Server, State } from '../src/shared/decorators';
import { InMemoryWebSocketRuntime } from '../src/shared/runtime';
import { RateLimit, __resetRateLimitForTests, setRateLimitStore } from '../src/shared/rate-limit';

vi.mock('../src/shared/environment', () => ({ isServer: true }));
afterEach(() => __resetRateLimitForTests());
it('uses the action peer environment instead of a shared component first-peer binding', async () => {
    __resetRateLimitForTests();
    const binding = () => {
        let count = 0;
        return { idFromName: (name: string) => name, get: vi.fn(() => ({
            fetch: async () => Response.json({ count: ++count, resetAt: Date.now() + 60000 }),
        })) };
    };
    const a = binding(); const b = binding();
    const envA = { rateLimit: 'do', RATE_LIMIT_DO: a };
    const envB = { rateLimit: 'do', RATE_LIMIT_DO: b };
    class Limited extends Cossack {
        @State() count = 0;
        @Server() @RateLimit({ max: 1 }) limited() { return ++this.count; }
        setFixtureEnv() { this.env = envA; }
        render() { return null as any; }
    }
    const component = createInstance(Limited) as Limited;
    component.setFixtureEnv(); component.connectedCallback();
    const runtime = new InMemoryWebSocketRuntime(component);
    const peer = (env: typeof envA) => {
        const frames: any[] = [];
        const client = { readyState: 1, send: (data: string) => frames.push(JSON.parse(data)) };
        const context = new Context(new Request('http://localhost/ws'), { env });
        runtime.addClient(client, { id: 'same-member' }, context);
        return { client, frames };
    };
    const first = peer(envA); const second = peer(envB);
    const invoke = async (caller: ReturnType<typeof peer>, id: string) => {
        await runtime.onClientMessage(caller.client, JSON.stringify({ v: 1, type: 'action', action: 'limited', requestId: id, payload: [] }));
        return caller.frames.find(frame => frame.requestId === id);
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
        expect(await invoke(first, 'a')).toMatchObject({ type: 'done', value: 1 });
        expect(await invoke(second, 'b')).toMatchObject({ type: 'done', value: 2 });
        expect(await invoke(first, 'a-again')).toMatchObject({ type: 'error', code: 'COSSACK_RPC_RATE_LIMITED' });
        expect(await invoke(second, 'b-again')).toMatchObject({ type: 'error', code: 'COSSACK_RPC_RATE_LIMITED' });
        expect(component.count).toBe(2);
        expect(a.get).toHaveBeenCalledTimes(2); expect(b.get).toHaveBeenCalledTimes(2);
    } finally { spy.mockRestore(); await component.destroyAsync(); }
});

it.each(['process close', 'durable close', 'durable error'] as const)('cancels a counter decision on %s and releases the shared component queue', async kind => {
    class Limited extends Cossack {
        @State() count = 0;
        @Server() @RateLimit({ max: 1 }) limited() { return ++this.count; }
        @Server() next() { return ++this.count; }
        render() { return null as any; }
    }
    let resolve!: (value: any) => void;
    const pending = new Promise<any>(r => { resolve = r; });
    let signal!: AbortSignal;
    const hit = vi.fn((_key, _window, options) => { signal = options.signal; return pending; });
    setRateLimitStore({ hit });
    const component = createInstance(Limited) as Limited; component.connectedCallback();
    const runtime = new InMemoryWebSocketRuntime(component);
    const frames: any[] = []; const peer = { readyState: 1, send: (data: string) => frames.push(JSON.parse(data)) };
    runtime.addClient(peer);
    const job = runtime.onClientMessage(peer, JSON.stringify({ type: 'action', requestId: 'held', action: 'limited', payload: [] }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
        await vi.waitFor(() => expect(hit).toHaveBeenCalledTimes(1));
        if (kind === 'process close') runtime.removeClient(peer);
        else {
            // These callbacks need no initialized component or platform storage.
            const object = Object.create(CossackDurableObject.prototype) as CossackDurableObject;
            if (kind === 'durable close') await object.webSocketClose(peer as any, 1000, '', true);
            else await object.webSocketError(peer as any);
        }
        await job;
        expect(signal.aborted).toBe(true); expect(rpcCancellations(peer).size).toBe(0);
        expect(component.count).toBe(0); expect(frames).toEqual([]);
        const other = { readyState: 1, send: (data: string) => frames.push(JSON.parse(data)) };
        runtime.addClient(other);
        await runtime.onClientMessage(other, JSON.stringify({ type: 'action', requestId: 'next', action: 'next', payload: [] }));
        expect(frames.filter(frame => frame.requestId)).toEqual([expect.objectContaining({ type: 'done', requestId: 'next', value: 1 })]);
        resolve({ count: 1, resetAt: Date.now() + 60000 }); await Promise.resolve(); await Promise.resolve();
        expect(component.count).toBe(1); expect(frames.filter(frame => frame.requestId)).toHaveLength(1);
    } finally { resolve({ count: 1, resetAt: Date.now() + 60000 }); await job; spy.mockRestore(); await component.destroyAsync(); }
});
