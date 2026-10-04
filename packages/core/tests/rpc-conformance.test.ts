import 'reflect-metadata';
import { startDevelopmentTrace } from '../src/shared/development-trace';
import { parseDevelopmentSocketEvidence } from '../src/shared/development-rpc-evidence';
import { Hono, type Context } from 'hono';
import { CossackElement } from '@cossackframework/renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { ClientVisibleError } from '../src/shared/errors';
import { input } from '../src/shared/input-schema';
import { Server, State } from '../src/shared/decorators';
import { proxyHttpMethods, proxyServerMethods } from '../src/shared/method-proxy';
import { failPendingSocketCalls, routeSocketFrame } from '../src/shared/transport-connections';
import { InMemoryWebSocketRuntime } from '../src/shared/runtime';
import { createInstance } from '../src/shared/container';
import { ServiceScope } from '../src/shared/service-scope';
import { Service } from '../src/shared/decorators';
import { forwardServiceMethods } from '../src/shared/service-bootstrap';
import { describeUnsupportedValue, rpc$, readRpcStream, RPC_STREAM_CONTENT_TYPE, RpcError } from '../src/shared/rpc-stream';
import { RateLimit, InMemoryRateLimitStore, setRateLimitStore, __resetRateLimitForTests } from '../src/shared/rate-limit';

// The realtime server component must take the server lifecycle (no client
// proxies on its actions); client surfaces in this suite are plain mocks.
vi.mock('../src/shared/environment', () => ({ isServer: true }));

/**
 * RT-01 conformance: WebSocket transport and explicit service RPC follow the
 * same request-scoped contract as HTTP/SSE component calls — one dispatched
 * mutation per call, promise-or-iterator consumption, correlated errors,
 * cancellation, deadlines, and uncertain-outcome semantics.
 */

class Shared {
    ready = false;
}

// Server-side component: executed by the in-memory runtime through real
// executeAction dispatch (no window → server environment).
class ServerComponent extends Cossack {
    @State() count = 0;
    runs = 0;

    @Server()
    async ordinary(delta: number) {
        this.count += delta;
        return this.count;
    }

    @Server()
    async *stream(steps: number) {
        this.runs++;
        for (let step = 1; step <= steps; step++) {
            await new Promise(resolve => setTimeout(resolve, 5));
            this.count++;
            yield { step, count: this.count };
        }
        return `done:${this.runs}`;
    }

    @Server()
    async failVisible() {
        throw new ClientVisibleError('Prompt is required');
    }

    @Server()
    async failInternal() {
        throw new Error('SECRET_TOKEN must stay private');
    }

    @Server({ timeout: 30 })
    async neverResponds() {
        return new Promise(() => {});
    }

    @Server({ timeout: 20 })
    async *slowStream() {
        yield 'first';
        await new Promise(() => {});
        return 'never';
    }

    @Server({ input: input.object({title:input.string({required:true,minLength:2})}) })
    async guarded(input: { title: string }) {
        return `saved:${input.title}`;
    }

    render() { return null as any; }
}

function makeClientComponent() {
    const component: any = {
        constructor: class Client {},
        websockets: new Map(),
        __cossack_proxies: new Map(),
        loading: {},
        _optimisticLockedKeys: {},
        _optimisticPendingState: {},
        count: 0,
        consume: () => undefined,
        hasMethod: () => false,
        getMethod: () => undefined,
        getPublicState() { return { count: this.count }; },
        _isOptimisticLocked: () => false,
        setProperty(key: string, value: unknown) { (this as any)[key] = value; },
        requestUpdate() {},
    };
    return component;
}

/** Loopback socket pair wiring the client proxy to the real server runtime. */
function makeLoopback(runtime: InMemoryWebSocketRuntime) {
    const serverSocket = { readyState: 1, sent: [] as string[], send: (data: string) => deliverToClient(data) };
    const clientSocket: any = {
        readyState: 1,
        sent: [] as string[],
        onmessage: null as ((event: { data: string }) => void) | null,
        onclose: null as (() => void) | null,
        send(data: string) {
            clientSocket.sent.push(data);
            void runtime.onClientMessage(serverSocket, data);
        },
        close() { clientSocket.readyState = 3; },
    };
    clientSocket.onmessage = ({ data }: { data: string }) => {
        try { routeSocketFrame(clientSocket, JSON.parse(data)); } catch { /* not JSON */ }
    };
    const deliverToClient = (data: string) => {
        clientSocket.onmessage?.({ data });
    };
    runtime.addClient(serverSocket);
    return { serverSocket, clientSocket };
}

describe('realtime (WebSocket) RPC conformance', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let server: ServerComponent;
    let runtime: InMemoryWebSocketRuntime;
    let client: any;
    let sockets: ReturnType<typeof makeLoopback>;

    beforeEach(() => {
        __resetRateLimitForTests();
        (globalThis as any).WebSocket = Object.assign(class {}, { OPEN: 1 });
        server = createInstance(ServerComponent) as ServerComponent;
        // Initialize the reactive state container without the full bootstrap
        // lifecycle (which expects a request context).
        server.connectedCallback();
        runtime = new InMemoryWebSocketRuntime(server);
        client = makeClientComponent();
        sockets = makeLoopback(runtime);
        client.websockets.set('page', sockets.clientSocket);
        Reflect.defineMetadata('cossack:server-methods', {
            neverResponds: { timeout: 30 },
            slowStream: { timeout: 20 },
        }, client.constructor);
        proxyServerMethods(client, ['ordinary', 'stream', 'failVisible', 'failInternal', 'neverResponds', 'slowStream', 'guarded']
            .map(name => ({ name, channel: 'global', provider: 'page' })));
    });
    afterEach(() => {
        delete (globalThis as any).WebSocket;
        errSpy.mockClear();
    });

    it.each(['ordinary', 'stream', 'failure', 'denied', 'invalid-input'] as const)('joins real socket %s dispatch with client state and terminal events', async kind => {
        const capture = startDevelopmentTrace();
        try {
            if (kind === 'ordinary') expect(await client.ordinary(5)).toBe(5);
            if (kind === 'stream') expect(await client.stream(3)).toBe('done:1');
            if (kind === 'failure') await expect(client.failInternal()).rejects.toMatchObject({ code: 'COSSACK_RPC_INTERNAL_ERROR' });
            if (kind === 'invalid-input') await expect(client.guarded({ title: 'x' })).rejects.toMatchObject({ code: 'COSSACK_VALIDATION_FAILED' });
            if (kind === 'denied') {
                proxyServerMethods(client, [{ name: 'destroy', channel: 'global', provider: 'page' }]);
                await expect(client.destroy()).rejects.toMatchObject({ code: 'COSSACK_RPC_FORBIDDEN' });
            }
            const request = JSON.parse(sockets.clientSocket.sent[0]);
            const events = capture.snapshot().events;
            const evidence = events.filter(event => event.kind === 'server-socket');
            expect(evidence.map(event => event.frame)).toEqual(kind === 'stream' ? ['yield', 'done'] : [kind === 'ordinary' ? 'done' : 'error']);
            expect(new Set(evidence.map(event => event.dispatchId)).size).toBe(1);
            for (const event of evidence) {
                expect(event).toMatchObject({ callId: request.developmentTrace, requestId: request.requestId,
                    invokedAt: kind === 'denied' || kind === 'invalid-input' ? null : expect.any(Number),
                    returnedAt: ['denied', 'failure', 'invalid-input'].includes(kind) ? null : expect.any(Number),
                    result: kind === 'stream' ? 'stream' : kind === 'ordinary' ? 'value' : 'none' });
                const { kind: _, phase, sequence, timestamp, ...wire } = event;
                expect(parseDevelopmentSocketEvidence(JSON.stringify(wire))).toEqual(wire);
            }
            expect(events.filter(event => event.kind === 'rpc' && event.phase === 'finish')).toHaveLength(1);
            expect(client.count).toBe(kind === 'ordinary' ? 5 : kind === 'stream' ? 3 : 0);
            expect(client.loading).toEqual({});
            expect(JSON.stringify(events)).not.toMatch(/SECRET_TOKEN|ordinary|failInternal|destroy|done:1/);
        } finally { capture.stop(); }
    });

    it('keeps queued socket dispatch identities separate and emits no evidence without capture', async () => {
        await client.ordinary(1);
        expect(JSON.parse(sockets.clientSocket.sent[0]).developmentTrace).toBeUndefined();
        const capture = startDevelopmentTrace();
        try {
            expect(await Promise.all([client.ordinary(2), client.ordinary(4)])).toEqual([3, 7]);
            const evidence = capture.snapshot().events.filter(event => event.kind === 'server-socket');
            expect(evidence).toHaveLength(2);
            expect(new Set(evidence.map(event => event.dispatchId)).size).toBe(2);
            const requests = sockets.clientSocket.sent.slice(1).map((raw: string) => JSON.parse(raw));
            expect(evidence.map(event => [event.callId, event.requestId])).toEqual(requests.map((request: any) => [request.developmentTrace, request.requestId]));
            expect(server.count).toBe(7);
        } finally { capture.stop(); }
    });

    it('does not invent a server terminal when a paused socket stream is cancelled', async () => {
        const capture = startDevelopmentTrace();
        try {
            const call = client.slowStream(), iterator = call[Symbol.asyncIterator]();
            expect(await iterator.next()).toEqual({ value: 'first', done: false });
            await call.cancel(); await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
            const events = capture.snapshot().events;
            expect(events.filter(event => event.kind === 'server-socket').map(event => event.frame)).toEqual(['yield']);
            expect(events.at(-1)).toMatchObject({ kind: 'rpc', phase: 'finish', outcome: 'cancelled' });
        } finally { capture.stop(); }
    });

    it('awaits ordinary results with server state and clears loading', async () => {
        const call = client.ordinary(5);
        expect(client.loading.ordinary).toBeTruthy();
        await expect(call).resolves.toBe(5);
        expect(client.count).toBe(5);
        expect(client.loading.ordinary).toBeUndefined();
    });

    it('shares a caller budget across connections while isolating authenticated users', async () => {
        class Limited extends ServerComponent {
            @Server() @RateLimit({ max: 1, window: 60_000, key: c => c.get('user').id })
            limited() { return ++this.count; }
        }
        const limited = createInstance(Limited) as Limited; limited.connectedCallback();
        const engine = new InMemoryWebSocketRuntime(limited);
        const invoke = async (id: string, succeed: boolean) => {
            const pair = makeLoopback(engine); engine.addClient(pair.serverSocket, { id });
            client.websockets.set('page', pair.clientSocket);
            proxyServerMethods(client, [{ name: 'limited', channel: 'global', provider: 'page' }]);
            if (succeed) await expect(client.limited()).resolves.toBe(limited.count + 1);
            else await expect(client.limited()).rejects.toMatchObject({ code: 'COSSACK_RPC_RATE_LIMITED', requestId: expect.any(String) });
            expect(client.loading).toEqual({});
        };
        await invoke('alice', true); await invoke('alice', false); await invoke('bob', true);
        expect(limited.count).toBe(2); await limited.destroyAsync();
    });
    it('enforces forwarded service rate metadata before mutation', async () => {
        @Service() class LimitedService {
            calls = 0;
            @Server() @RateLimit({ max: 1, window: 60_000 })
            limitedService() { return ++this.calls; }
        }
        const service = new LimitedService(); forwardServiceMethods(server, service);
        proxyServerMethods(client, [{ name: 'limitedService', channel: 'global', provider: 'page' }]);
        expect(await client.limitedService()).toBe(1);
        await expect(client.limitedService()).rejects.toMatchObject({ code: 'COSSACK_RPC_RATE_LIMITED', requestId: expect.any(String) });
        expect(service.calls).toBe(1); expect(client.loading).toEqual({});
    });
    it('finds a limited child route owner through a renderer parent without Cossack methods', async () => {
        class LimitedChild extends ServerComponent {
            @Server() @RateLimit({ max: 1, window: 60_000 })
            limitedChild() { return ++this.count; }
        }
        const child = createInstance(LimitedChild) as LimitedChild; child.connectedCallback();
        child._id = 'child'; server.__cossack_rpcOwner = '/src/pages/owner/index.ts';
        const wrapper = new CossackElement();
        (wrapper as any).__parent = server; (child as any).__parent = wrapper;
        server.activeComponents.set(child._id, child);
        const counter = new InMemoryRateLimitStore(); const keys: string[] = [];
        setRateLimitStore({ hit(key, window) { keys.push(key); return counter.hit(key, window); } });
        client._id = 'child'; proxyServerMethods(client, [{ name: 'limitedChild', channel: 'global', provider: 'page' }]);
        expect(await client.limitedChild()).toBe(1);
        await expect(client.limitedChild()).rejects.toMatchObject({ code: 'COSSACK_RPC_RATE_LIMITED' });
        expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
        expect(keys[0]).toContain('/src/pages/owner/index.ts'); expect(child.count).toBe(1); expect(server.count).toBe(0);
        await server.destroyAsync();
    });
    it('dispatches to a real child and cannot execute a root action through invalid targets', async () => {
        const child = createInstance(ServerComponent) as ServerComponent; child.connectedCallback();
        child._id = 'child'; server.activeComponents.set(child._id, child);
        client._id = 'child'; expect(await client.ordinary(3)).toBe(3);
        expect(child.count).toBe(3); expect(server.count).toBe(0); expect(client.count).toBe(3);
        for (const target of ['missing', 7, '']) {
            client._id = target;
            await expect(client.ordinary(100)).rejects.toMatchObject({
                code: target === 'missing' ? 'COSSACK_RPC_NOT_FOUND' : 'COSSACK_RPC_REQUEST_INVALID', requestId: expect.any(String),
            });
        }
        client._id = 'child'; proxyServerMethods(client, [{ name: 'destroy', channel: 'global', provider: 'page' }]);
        await expect(client.destroy()).rejects.toMatchObject({ code: 'COSSACK_RPC_FORBIDDEN', requestId: expect.any(String) });
        expect(child.count).toBe(3); expect(server.count).toBe(0); expect(client.loading).toEqual({});
        await server.destroyAsync();
    });

    it('streams generator yields and applies per-frame state', async () => {
        const collected: unknown[] = [];
        const call = rpc$(client.stream(3));
        const consumer = (async () => { for await (const value of call) collected.push(value); })();
        await expect(call).resolves.toBe('done:1');
        await consumer;
        expect(collected).toEqual([
            { step: 1, count: 1 },
            { step: 2, count: 2 },
            { step: 3, count: 3 },
        ]);
        expect(client.count).toBe(3);
        expect(server.runs).toBe(1);
    });

    it('enforces @Server({ input }) with stable field errors', async () => {
        await expect(Promise.resolve(client.guarded({ title: 'x' })))
            .rejects.toMatchObject({ code: 'COSSACK_VALIDATION_FAILED', message: 'Validation failed.',
                fieldErrors: { title: expect.any(String) } });
        await expect(Promise.resolve(client.guarded({ title: 'ok title' }))).resolves.toBe('saved:ok title');
        expect(client.loading.guarded).toBeUndefined();
    });

    it('dispatches and validates inherited actions on a real derived server component', async () => {
        class Derived extends ServerComponent {
            @Server() ownAction() { return 'child'; }
        }
        const derived = createInstance(Derived) as Derived;
        derived.connectedCallback();
        const derivedRuntime = new InMemoryWebSocketRuntime(derived);
        const derivedSockets = makeLoopback(derivedRuntime);
        client.websockets.set('page', derivedSockets.clientSocket);
        await expect(Promise.resolve(client.guarded({ title: 'x' }))).rejects.toMatchObject({
            code: 'COSSACK_VALIDATION_FAILED', fieldErrors: { title: expect.any(String) },
        });
        await expect(Promise.resolve(client.guarded({ title: 'valid' }))).resolves.toBe('saved:valid');
        await expect(Promise.resolve(client.ordinary(3))).resolves.toBe(3);
    });

    it('authorizes forwarded services with their declaring metadata and socket actor',async()=>{
        let context!:Context;const app=new Hono<{Variables:{user:{id:string}}}>();
        app.get('/',c=>{context=c;c.set('user',{id:'stale-context'});return new Response(null);});await app.request('/');
        let actor={id:'owner'};
        const checks=vi.fn((value:{id:number},options:any)=>options.context.get('user')?.id==='owner' && value.id===1);
        class ProtectedService {
            calls=0;
            @Server({input:input.object({id:input.number({coerce:true})}),authorize:checks})
            forwarded(value:{id:number}){this.calls++;return value.id;}
        }
        const service=new ProtectedService();forwardServiceMethods(server,service);
        runtime=new InMemoryWebSocketRuntime(server,{getUser:()=>actor,getContext:()=>context});
        sockets=makeLoopback(runtime);client.websockets.set('page',sockets.clientSocket);
        proxyServerMethods(client,[{name:'forwarded',provider:'page',channel:'global'}]);
        await expect(client.forwarded({id:'1'})).resolves.toBe(1);expect(service.calls).toBe(1);
        actor={id:'other'};
        await expect(client.forwarded({id:1})).rejects.toMatchObject({code:'COSSACK_AUTH_FORBIDDEN',requestId:expect.any(String)});
        expect(service.calls).toBe(1);expect(checks).toHaveBeenCalledTimes(2);
        expect(client.loading).toEqual({});
    });

    it('validates forwarded service actions with their declaring class metadata', async () => {
        @Service()
        class ValidatedService {
            @Server({ input: input.object({title:input.string({required:true,minLength:2})}) })
            async forwarded(input: { title: string }) { return input.title; }
        }
        forwardServiceMethods(server, new ValidatedService());
        proxyServerMethods(client, [{ name: 'forwarded', provider: 'page', channel: 'global' }]);
        await expect(Promise.resolve(client.forwarded({ title: '' }))).rejects.toMatchObject({
            code: 'COSSACK_VALIDATION_FAILED', fieldErrors: { title: expect.any(String) },
        });
        await expect(Promise.resolve(client.forwarded({title:'valid',canEdit:true}))).rejects.toMatchObject({
            code:'COSSACK_VALIDATION_FAILED',fieldErrors:{canEdit:'Unknown field.'},
        });
        await expect(Promise.resolve(client.forwarded({ title: 'valid' }))).resolves.toBe('valid');
    });

    it('rejects client-visible failures with stable codes', async () => {
        await expect(Promise.resolve(client.failVisible()))
            .rejects.toMatchObject({ code: 'COSSACK_RPC_CLIENT_ERROR', message: 'Prompt is required' });
        expect(client.loading.failVisible).toBeUndefined();
    });

    it('redacts internal failures', async () => {
        await expect(Promise.resolve(client.failInternal()))
            .rejects.toMatchObject({ code: 'COSSACK_RPC_INTERNAL_ERROR', message: 'Internal Server Error' });
        expect(errSpy).toHaveBeenCalled();
    });

    it('consuming the call twice never dispatches a second mutation', async () => {
        const call = client.ordinary(2);
        const values: unknown[] = [];
        const consumer = (async () => { for await (const value of call) values.push(value); })();
        await expect(call).resolves.toBe(2);
        await expect(call).resolves.toBe(2);
        await consumer;
        expect(values).toEqual([]);
        expect(client.count).toBe(2);
        // Exactly one action frame for this method was dispatched.
        const dispatched = sockets.clientSocket.sent.filter((raw: string) => JSON.parse(raw).action === 'ordinary');
        expect(dispatched).toHaveLength(1);
    });

    it('cancels a streaming call and stops the server generator', async () => {
        const collected: unknown[] = [];
        const call = client.stream(5);
        const consumer = (async () => { for await (const value of call) collected.push(value); })().catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 25));
        expect(collected.length).toBeGreaterThanOrEqual(1);
        expect(collected.length).toBeLessThan(5);
        await call.cancel();
        await consumer;
        await expect(Promise.resolve(call)).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
        expect(client.loading.stream).toBeUndefined();
        // The cancel message terminated the server-side generator.
        expect(sockets.clientSocket.sent.some((raw: string) => JSON.parse(raw).type === 'cancel')).toBe(true);
    });

    it('enforces an inherited deadline when the derived client owns another server method', async () => {
        const Parent = client.constructor;
        client.constructor = class Child extends Parent {};
        Reflect.defineMetadata('cossack:server-methods', { ordinary: { timeout: 100 } }, client.constructor);
        await expect(Promise.resolve(client.neverResponds())).rejects.toMatchObject({ code: 'COSSACK_RPC_TIMEOUT' });
        expect(client.loading.neverResponds).toBeUndefined();
    });

    it('reports deadline expiry with uncertain-outcome semantics', async () => {
        await expect(Promise.resolve(client.neverResponds())).rejects.toMatchObject({
            code: 'COSSACK_RPC_TIMEOUT',
            message: expect.stringContaining('outcome is unknown'),
        });
        expect(client.loading.neverResponds).toBeUndefined();
    });

    it('cancels locally without waiting for an unresponsive server', async () => {
        const call = client.neverResponds();
        const observer = Promise.resolve(call).catch(error => error);
        await Promise.resolve();
        await expect(Promise.race([
            call.cancel().then(() => 'cancelled'),
            new Promise(resolve => setTimeout(() => resolve('stalled'), 100)),
        ])).resolves.toBe('cancelled');
        expect(await observer).toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
    });

    it('rejects unsupported results instead of dropping values or hanging', async () => {
        vi.spyOn(server, 'ordinary').mockResolvedValue({ nested: { cb: () => {} } } as any);
        await expect(Promise.resolve(client.ordinary(1))).rejects.toMatchObject({
            code: 'COSSACK_RPC_SERIALIZATION_FAILED',
            message: expect.stringContaining('value.nested.cb'),
        });
        expect(client.loading.ordinary).toBeUndefined();
    });

    it('rejects native HTTP responses on WebSockets instead of silently returning an empty object', async () => {
        vi.spyOn(server, 'ordinary').mockResolvedValue(new Response(null, { status: 302, headers: { Location: '/login' } }) as any);
        await expect(Promise.resolve(client.ordinary(1))).rejects.toMatchObject({
            code: 'COSSACK_RPC_HTTP_RESPONSE_REQUIRED', message: expect.stringContaining('HTTP or SSE'),
        });
        expect(client.loading).toEqual({});
        expect(sockets.clientSocket.sent.filter((data: string) => JSON.parse(data).type === 'action')).toHaveLength(1);
    });
    it.each([new Blob(['data']), new File(['data'], 'file.txt')])('rejects binary socket arguments before dispatch instead of dropping them', async value => {
        await expect(Promise.resolve(client.ordinary(value))).rejects.toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED',
            message: expect.stringContaining('payload[0] (binary value)') });
        expect(sockets.clientSocket.sent).toEqual([]);
        expect(server.count).toBe(0); expect(client.loading).toEqual({});
    });

    it('rejects malformed correlated socket frames before applying state', async () => {
        sockets.clientSocket.send = vi.fn();
        const call = client.ordinary(1);
        const requestId = JSON.parse(sockets.clientSocket.send.mock.calls[0][0]).requestId;
        routeSocketFrame(sockets.clientSocket, { v: 2, type: 'done', requestId, state: { count: 999 } });
        await expect(Promise.resolve(call)).rejects.toMatchObject({ code: 'COSSACK_RPC_STREAM_INVALID' });
        expect(client.count).toBe(0);
        expect(client.loading.ordinary).toBeUndefined();
    });

    it('bounds queued socket yields when the iterator consumer falls behind', async () => {
        sockets.clientSocket.send = vi.fn();
        const call = client.stream(300);
        const iterator = call[Symbol.asyncIterator]();
        const requestId = JSON.parse(sockets.clientSocket.send.mock.calls[0][0]).requestId;
        for (let index = 0; index < 300; index++) {
            routeSocketFrame(sockets.clientSocket, { v: 1, type: 'yield', requestId, value: index, state: { count: index } });
        }
        await expect(iterator.next()).rejects.toMatchObject({ code: 'COSSACK_RPC_BUFFER_EXCEEDED' });
        await expect(Promise.resolve(call)).rejects.toMatchObject({ code: 'COSSACK_RPC_BUFFER_EXCEEDED' });
        expect(client.loading.stream).toBeUndefined();
        expect(sockets.clientSocket.send.mock.calls.map(([data]: [string]) => JSON.parse(data).type)).toContain('cancel');
    });

    it('cancels a queued mutation before it starts', async () => {
        let release!: () => void;
        const gate = new Promise<number>(resolve => { release = () => resolve(0); });
        vi.spyOn(server, 'ordinary').mockImplementationOnce(() => gate);
        const first = client.ordinary(1);
        await Promise.resolve();
        const queued = client.ordinary(10);
        await queued.cancel();
        release();
        await first;
        await expect(Promise.resolve(queued)).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
        await server.executeAction('ordinary', [1], undefined, sockets.serverSocket, 'after-cancel');
        expect(server.count).toBe(1);
    });

    it('times out mid-stream and cancels the server generator', async () => {
        const collected: unknown[] = [];
        const call = client.slowStream();
        const consumer = (async () => { for await (const value of call) collected.push(value); })().catch(() => {});
        await expect(Promise.resolve(call)).rejects.toMatchObject({ code: 'COSSACK_RPC_TIMEOUT' });
        await consumer;
        expect(collected).toEqual(['first']);
        expect(client.loading.slowStream).toBeUndefined();
    });

    it('rejects pending calls with an uncertain outcome when the socket closes', async () => {
        const call = client.neverResponds();
        sockets.clientSocket.readyState = 3;
        failPendingSocketCalls(sockets.clientSocket);
        await expect(Promise.resolve(call)).rejects.toMatchObject({
            code: 'COSSACK_RPC_TRANSPORT_CLOSED',
            message: expect.stringContaining('unknown'),
        });
    });

    it('answers forbidden actions with a correlated error and stays usable', async () => {
        const frames: any[] = [];
        sockets.clientSocket.onmessage = ({ data }: { data: string }) => {
            frames.push(JSON.parse(data));
            routeSocketFrame(sockets.clientSocket, JSON.parse(data));
        };
        sockets.clientSocket.send(JSON.stringify({ v: 1, type: 'action', requestId: 'forged', action: 'destroy', payload: [] }));
        await new Promise(resolve => setTimeout(resolve, 5));
        expect(frames.at(-1)).toMatchObject({
            type: 'error', requestId: 'forged', code: 'COSSACK_RPC_FORBIDDEN',
        });
        // The runtime remains usable for legitimate calls afterwards.
        sockets.clientSocket.onmessage = ({ data }: { data: string }) => routeSocketFrame(sockets.clientSocket, JSON.parse(data));
        await expect(Promise.resolve(client.ordinary(1))).resolves.toBe(1);
    });
});

describe('service RPC conformance (client proxy over /crpc)', () => {
    @Service()
    class CounterService {
        @State() count = 0;
    }

    let scope: ServiceScope;
    let instance: CounterService;
    const subscribers: Array<() => void> = [];

    beforeEach(() => {
        (globalThis as any).window = {};
        Reflect.defineMetadata('cossack:server-methods', {
            increment: {}, stream: {}, fail: {}, cancelable: {},
        }, CounterService);
        scope = new ServiceScope(undefined, [CounterService], { ownerRouteId: 'layout_1' });
        instance = scope.resolveDeclared(CounterService) as CounterService;
    });
    afterEach(() => {
        delete (globalThis as any).window;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        for (const off of subscribers.splice(0)) off();
    });

    function ndjsonResponse(frames: unknown[]) {
        const body = frames.map(frame => `${JSON.stringify(frame)}\n`).join('');
        return new Response(body, { headers: { 'Content-Type': RPC_STREAM_CONTENT_TYPE } });
    }

    it('awaits ordinary results and hydrates service state', async () => {
        const fetchMock = vi.fn(async () => new Response(
            JSON.stringify({ _cossack_service_state: { count: 7 }, _cossack_return: 7 }),
            { headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
        (scope as any).installClientProxy({ serviceClass: CounterService, slot: '0', instance });
        await expect((instance as any).increment()).resolves.toBe(7);
        expect(instance.count).toBe(7);
        const body = JSON.parse((fetchMock.mock.calls[0] as any[])[1].body);
        expect(body.service).toEqual({ ownerRouteId: 'layout_1', slot: '0' });
        expect(body.action).toBe('increment');
    });

    it('streams service generator results frame by frame', async () => {
        const fetchMock = vi.fn(async () => ndjsonResponse([
            { v: 1, type: 'yield', requestId: 'r1', value: 'a', state: { count: 1 } },
            { v: 1, type: 'yield', requestId: 'r1', value: 'b', state: { count: 2 } },
            { v: 1, type: 'done', requestId: 'r1', value: 'finished', state: { count: 2 } },
        ]));
        vi.stubGlobal('fetch', fetchMock);
        (scope as any).installClientProxy({ serviceClass: CounterService, slot: '0', instance });
        const collected: unknown[] = [];
        const call = rpc$((instance as any).stream());
        for await (const value of call) collected.push(value);
        await expect(call).resolves.toBe('finished');
        expect(collected).toEqual(['a', 'b']);
        expect(instance.count).toBe(2);
    });

    it('maps HTTP failures to RpcError codes and clears loading', async () => {
        const fetchMock = vi.fn(async () => new Response(
            JSON.stringify({ error: 'Prompt is required', code: 'COSSACK_RPC_CLIENT_ERROR' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
        (scope as any).installClientProxy({ serviceClass: CounterService, slot: '0', instance });
        await expect(Promise.resolve((instance as any).fail()))
            .rejects.toMatchObject({ code: 'COSSACK_RPC_CLIENT_ERROR', status: 400 });
    });

    it('preserves structured validation errors on component and explicit service HTTP calls', async () => {
        (globalThis as any).window = { location: { search: '' } };
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            error: 'Validation failed.', code: 'COSSACK_VALIDATION_FAILED', fieldErrors: { title: 'Required' },
        }), { status: 400, headers: { 'X-Cossack-Request-Id': 'validated' } })));
        const component = makeClientComponent();
        component.getInitialStateFromWindow = () => ({ componentRouteId: 'validated-page' });
        proxyHttpMethods(component, [{ name: 'save' }]);
        (scope as any).installClientProxy({ serviceClass: CounterService, slot: '0', instance });
        for (const call of [component.save({}), (instance as any).fail({})]) {
            await expect(Promise.resolve(call)).rejects.toMatchObject({ code: 'COSSACK_VALIDATION_FAILED',
                status: 400, requestId: 'validated', fieldErrors: { title: 'Required' } });
        }
    });

    it('supports cancellation through the request signal', async () => {
        const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
                reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
        }));
        vi.stubGlobal('fetch', fetchMock);
        (scope as any).installClientProxy({ serviceClass: CounterService, slot: '0', instance });
        const call = (instance as any).cancelable();
        await new Promise(resolve => setTimeout(resolve, 5));
        await call.cancel();
        await expect(Promise.resolve(call)).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
    });

    it('reports network uncertainty without retrying service mutations or leaking loading', async () => {
        const fetchMock = vi.fn(async () => { throw new TypeError('connection lost'); });
        vi.stubGlobal('fetch', fetchMock);
        const consumer = { loading: {}, requestUpdate() {} };
        subscribers.push(scope.subscribe(CounterService, consumer));
        await expect(Promise.resolve((instance as any).increment())).rejects.toMatchObject({
            code: 'COSSACK_RPC_NETWORK_FAILED', message: expect.stringContaining('server outcome is unknown'),
        });
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(consumer.loading).toEqual({});
    });
});

describe('serialization diagnostics by value path (RT-01)', () => {
    it('locates unsupported values in nested trees', async () => {
        expect(describeUnsupportedValue({ a: { b: 1 } })).toBeNull();
        expect(describeUnsupportedValue({ items: [1, { onChange: () => {} }] })).toBe('items[1].onChange (function)');
        expect(describeUnsupportedValue({ meta: { count: 10n } })).toBe('meta.count (bigint)');
        const cyclic: any = { self: null };
        cyclic.self = cyclic;
        expect(describeUnsupportedValue(cyclic)).toBe('self (cyclic reference)');
        expect(describeUnsupportedValue(new WeakMap())).toBe('(root) (weak collection)');
        const shared = { value: 1 };
        expect(describeUnsupportedValue({ left: shared, right: shared })).toBeNull();
        expect(describeUnsupportedValue({ items: new Map([['a', 1]]) })).toBe('items (Map)');
    });

    it('names native HTTP objects that JSON would silently turn into empty objects', () => {
        for (const [value, name] of [[new Response(), 'Response'], [new Request('https://example.test'), 'Request'], [new Headers(), 'Headers']] as const) {
            expect(describeUnsupportedValue({ nested: value }, 'payload')).toBe(`payload.nested (${name})`);
        }
    });

    it('HTTP proxy serialization failures name the offending argument path', async () => {
        const component = makeClientComponent();
        // Client component without window-independent HTTP proxies: exercise
        // the proxy through proxyHttpMethods with stubbed fetch/globals.
        (globalThis as any).window = { location: { search: '' } };
        const fetchMock = vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
        Reflect.defineMetadata('cossack:server-methods', { save: {} }, component.constructor);
        Reflect.defineMetadata('page:options', { transport: 'http' }, component.constructor);
        component.getInitialStateFromWindow = () => ({ componentRouteId: 'cmp_x', scopeKey: 'user:anonymous' });
        proxyHttpMethods(component, [{ name: 'save' }]);
        const call = (component as any).save({ ok: 1, cb: () => {} });
        await expect(Promise.resolve(call)).rejects.toMatchObject({
            code: 'COSSACK_RPC_SERIALIZATION_FAILED',
            message: expect.stringContaining('cb (function)'),
        });
        expect(fetchMock).not.toHaveBeenCalled();
        delete (globalThis as any).window;
        vi.unstubAllGlobals();
    });
});

describe('upload boundary normalization (RT-01 audit)', () => {
    it('rejects Maps and Sets in raw arguments with the original path', async () => {
        const component = makeClientComponent();
        (globalThis as any).window = { location: { search: '' } };
        const fetchMock = vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
        Reflect.defineMetadata('cossack:server-methods', { save: {} }, component.constructor);
        Reflect.defineMetadata('page:options', { transport: 'http' }, component.constructor);
        component.getInitialStateFromWindow = () => ({ componentRouteId: 'cmp_x', scopeKey: 'user:anonymous' });
        proxyHttpMethods(component, [{ name: 'save' }]);

        await expect(Promise.resolve((component as any).save({ lookup: new Map([['a', 1]]) }))).rejects.toMatchObject({
            code: 'COSSACK_RPC_SERIALIZATION_FAILED',
            message: expect.stringContaining('payload[0].lookup (Map)'),
        });
        await expect(Promise.resolve((component as any).save(new Set([1]))))
            .rejects.toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED' });
        expect(fetchMock).not.toHaveBeenCalled();

        delete (globalThis as any).window;
        vi.unstubAllGlobals();
    });

    it('handled options exempt values from the shared walker', () => {
        class FakeFile { }
        const handled = (value: object) => value instanceof FakeFile;
        expect(describeUnsupportedValue({ attachment: new FakeFile() }, '', new WeakSet(), { handled })).toBeNull();
        expect(describeUnsupportedValue({ lookup: new Map() }, '', new WeakSet(), { handled }))
            .toBe('lookup (Map)');
    });
});

describe('rpc protocol helpers', () => {
    it('readRpcStream still enforces the frame contract for correlated frames', async () => {
        const response = new Response(
            `{"v":1,"type":"yield","requestId":"a","value":1,"state":{}}\n` +
            `{"v":1,"type":"done","requestId":"a","value":2,"state":{}}\n`,
            { headers: { 'Content-Type': RPC_STREAM_CONTENT_TYPE } });
        const frames = [];
        for await (const frame of readRpcStream(response)) frames.push(frame);
        expect(frames).toHaveLength(2);
        expect(frames[1]).toMatchObject({ type: 'done', value: 2 });
        expect(new RpcError('COSSACK_RPC_TIMEOUT', 'x')).toMatchObject({ code: 'COSSACK_RPC_TIMEOUT' });
    });
});
