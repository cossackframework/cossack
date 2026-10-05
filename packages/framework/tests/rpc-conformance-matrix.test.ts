import 'reflect-metadata';
import { Hono, type Context } from 'hono';
import {HTTPException} from 'hono/http-exception';
import { createResourcePolicy } from '../../auth/src/index';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    Cossack, CossackService, ClientVisibleError, ActionValidationError, createInstance, InMemoryWebSocketRuntime,
    Page, rpc$, Server, Service, ServiceScope, State, RateLimit, input, type InputOf, setRateLimitStore, __resetRateLimitForTests, RPC_NATIVE_RESPONSE_MAX_BYTES, getRequestContext,
} from '@cossackframework/core';
// Wire browser-side transport boundaries from the same built core modules the
// public entry uses. These internals are deliberately not new application APIs.
import { proxyHttpMethods, proxyServerMethods } from '../../core/dist/shared/method-proxy.js';
import { failPendingSocketCalls, routeSocketFrame, wsPendingCalls } from '../../core/dist/shared/transport-connections.js';
import { computeRouteIds } from '../src/route-ids';

const { registry, effects } = vi.hoisted(() => ({
    registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} },
    effects: { current: { runs: 0, streamsClosed: 0, disposed: 0, jsonCalls: 0, nativePulls: 0, fileContinue: undefined as (() => void) | undefined } },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [async (c:any,next:()=>Promise<void>)=>{
    c.set('user',c.env?.TEST_POLICY_USER); await next();
}] }));
vi.mock('virtual:cossack-config', () => ({ default: {} }));

// Finite application I/O lets teardown prove eventual remote cleanup even when
// a caller has already timed out/disconnected. Cancellation is not rollback.
const normalizedInput = input.object({profile:input.object({age:input.number({coerce:true,integer:true,min:1})}), enabled:input.boolean({coerce:true}), tags:input.array(input.enum(['draft','published']),{maxItems:2}), note:input.string().optional()});
const privateCallbackFailures=[new ClientVisibleError('PRIVATE_CALLBACK_VISIBLE'),new ActionValidationError({secret:'PRIVATE_CALLBACK_FIELDS'}),new HTTPException(418,{message:'PRIVATE_CALLBACK_HTTP'})];
interface PolicyPost {id:number;owner:string;tenant:string;}
interface PolicyActor {id:string;tenant:string;}
const records:PolicyPost[]=[{id:1,owner:'u1',tenant:'t1'},{id:2,owner:'u2',tenant:'t1'},{id:3,owner:'u1',tenant:'t2'}];
const policyLookup=vi.fn((data:{id:number})=>records.find(record=>record.id===data.id));
const policy=createResourcePolicy<PolicyPost,PolicyActor>()({edit:({user,resource})=>user.id===resource.owner && user.tenant===resource.tenant});
const policyInput=input.object({id:input.number({coerce:true,integer:true,min:1})});
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 160));
class DataModel { id = 7; when = new Date('2026-10-03'); save() { throw new Error('never called'); } }
class JsonRecord { private readonly owner = effects.current; toJSON() { this.owner.jsonCalls++; return { when: new Date('2026-10-03'), title: 'serialized' }; } }
const wireData = () => ({ when: new Date('2026-10-03'), model: new DataModel(), custom: new JsonRecord(), absent: undefined, list: [undefined, null] });
const expectedWireData = { when: '2026-10-03T00:00:00.000Z', model: { id: 7, when: '2026-10-03T00:00:00.000Z' }, custom: { when: '2026-10-03T00:00:00.000Z', title: 'serialized' }, list: [null, null] };
const lossyValues = [NaN, new Date('invalid'), new Uint8Array([1]), { toJSON() { return { callback() {} }; } }];
function actions<T extends abstract new (...args: any[]) => object>(Base: T) {
    abstract class Actions extends Base {
        constructor(...args: any[]) { super(...args); }
        // A cancelled response may finish cleanup after its caller settles.
        // Keep that request attached to its original fixture counters.
        protected readonly effectOwner = effects.current;
        @State() count = 0;
        @Server() @RateLimit({ max: 1, window: 60_000, message: 'Try later' })
        limited() { this.effectOwner.runs++; return ++this.count; }
        @Server() @RateLimit({ max: 1, window: 60_000 })
        async *limitedStream() { this.effectOwner.runs++; yield ++this.count; return ++this.count; }
        @Server() @RateLimit({ backendTimeoutMs: 20 })
        limitedDeadline() { this.effectOwner.runs++; return ++this.count; }
        @Server({ timeout: 80 }) @RateLimit({ max: 1 })
        limitedClientDeadline() { this.effectOwner.runs++; return ++this.count; }
        @Server() @RateLimit({ max: NaN })
        invalidLimit() { this.effectOwner.runs++; return ++this.count; }
        @Server() @RateLimit({ key: () => '' })
        invalidRateKey() { this.effectOwner.runs++; return ++this.count; }
        @Server() @RateLimit(null as any)
        invalidRateOptions() { this.effectOwner.runs++; return ++this.count; }
        @Server() @RateLimit({ max: 1, requires: { shared: true, atomicIncrement: true } })
        sharedAtomicLimit() { this.effectOwner.runs++; return ++this.count; }
        @Server({ input: input.object({ title: input.string({required:true}), nested: input.object({files: input.array(input.file({maxBytes:16}), {minItems:1,maxItems:3})}) }) })
        async fileInfo(input: { title: string; nested: { files: File[] } }) {
            this.effectOwner.runs++; this.count++;
            return { title: input.title, files: await Promise.all(input.nested.files.map(async file => ({ name: file.name, text: await file.text() }))), path: getRequestContext()?.req.path };
        }
        @Server() async *fileStream(input: { nested: { files: File[] } }) {
            this.effectOwner.runs++;
            try {
                this.count++; yield await input.nested.files[0].text();
                await new Promise<void>(resolve => {
                    const signal = getRequestContext()?.req.raw.signal;
                    const proceed = () => { signal?.removeEventListener('abort', proceed); resolve(); };
                    this.effectOwner.fileContinue = proceed;
                    signal?.addEventListener('abort', proceed, { once: true });
                    if (signal?.aborted) proceed();
                });
                this.count++; return this.count;
            }
            finally { this.effectOwner.streamsClosed++; }
        }
        @Server() native(index: number) {
            this.effectOwner.runs++; this.count++;
            const headers = { 'X-Custom': 'kept', 'X-Cossack-Rpc-Response': 'wrong' };
            if (index === 0) return Response.json({ _cossack_redirect: '/wrong', _cossack_return: 'data', count: 999 }, { status: 201, headers });
            if (index === 1) return new Response('native text', { status: 202, headers });
            if (index === 2) return new Response(new Uint8Array([0, 255, 128]), { headers: { ...headers, 'Content-Type': 'application/octet-stream' } });
            if (index === 3) return new Response(null, { status: 204, headers });
            if (index === 4) return new Response('opaque, not RPC frames', { headers: { ...headers, 'Content-Type': 'application/x-cossack-rpc+ndjson' } });
            if (index === 7) return new Response(new ReadableStream<Uint8Array>({
                start(controller) { controller.enqueue(new Uint8Array([1])); },
                pull(controller) { controller.error(new TypeError('private producer failure')); },
            }, { highWaterMark: 0 }));
            if (index === 5) return new Response('x'.repeat(RPC_NATIVE_RESPONSE_MAX_BYTES + 1));
            return new Response('deliberate failure', { status: 422, headers });
        }
        @Server({ timeout: 80 }) slowNative() {
            this.effectOwner.runs++;
            const owner = this.effectOwner;
            let step = 0;
            return new Response(new ReadableStream<Uint8Array>({
                async pull(controller) { owner.nativePulls++; if (step++) { await pause(); controller.close(); } else controller.enqueue(new Uint8Array([1])); },
                cancel() { owner.streamsClosed++; },
            }, { highWaterMark: 0 }));
        }
        @Server() async echo(value: unknown) { this.effectOwner.runs++; return value; }
        @Server() async structured() { this.effectOwner.runs++; return wireData(); }
        @Server() rootJson() { return { toJSON(key: string) { return { key }; } }; }
        @Server() async *rootJsonStream() { yield this.rootJson(); return this.rootJson(); }
        @Server() async *structuredStream() { yield wireData(); return wireData(); }
        @Server() async lossy(index: number) { this.effectOwner.runs++; return { invalid: lossyValues[index] }; }
        @Server() async ordinary(delta: number) { this.effectOwner.runs++; this.count += delta; return { count: this.count }; }
        @Server() async *stream() {
            this.effectOwner.runs++;
            try {
                this.count++; yield { count: this.count };
                this.count++; yield { count: this.count };
                return { total: this.count };
            } finally { this.effectOwner.streamsClosed++; }
        }
        @Server() async *streamError() {
            this.effectOwner.runs++;
            try { yield 'first'; throw new ClientVisibleError('Rejected after progress'); }
            finally { this.effectOwner.streamsClosed++; }
        }
        @Server() async visible() { this.effectOwner.runs++; throw new ClientVisibleError('Prompt required'); }
        @Server() async internal() { this.effectOwner.runs++; throw new Error('PRIVATE_TOKEN must never reach the caller'); }
        @Server() async *internalStream() { this.effectOwner.runs++; throw new Error('PRIVATE_TOKEN stream failure'); }
        @Server({ input: input.object({ title: input.string({required:true}) }) })
        async validated(input: { title: string }) { this.effectOwner.runs++; return input.title; }
        @Server({input:normalizedInput})
        normalized(value:InputOf<typeof normalizedInput>) { this.effectOwner.runs++; return value; }
        @Server({input:normalizedInput})
        normalizedField=(value:InputOf<typeof normalizedInput>)=>{this.effectOwner.runs++;return value;};
        // Exercise stale JavaScript metadata even though TypeScript now rejects maps.
        @Server({input:{profile:{required:true}}} as any)
        oldInput(value:unknown){this.effectOwner.runs++;return value;}
        @Server({input:input.string().refine(() => {throw new Error('PRIVATE_SCHEMA_FAILURE');})})
        brokenValidation(value:string) { this.effectOwner.runs++; return value; }
        @Server({input:input.number().refine(index=>{throw privateCallbackFailures[index];})})
        publicValidationException(index:number){this.effectOwner.runs++;return index;}
        @Server({input:input.number(),authorize:index=>{throw privateCallbackFailures[index];}})
        publicPolicyException(index:number){this.effectOwner.runs++;return index;}
        @Server({input:input.string().refine(async (_value, options) => {
            const owner=effects.current;
            await new Promise<void>(resolve => {
                owner.fileContinue=resolve;
                options.signal?.addEventListener('abort', () => resolve(), {once:true});
            });
            return true;
        })})
        waitingValidation(value:string) { this.effectOwner.runs++; return value; }
        @Server({input:policyInput,authorize:policy.action('edit',policyLookup)})
        protectedMutation(value:InputOf<typeof policyInput>) { this.effectOwner.runs++;this.count++;return value.id; }
        @Server({input:policyInput,authorize:()=>{throw Error('PRIVATE_POLICY_EXCEPTION');}})
        brokenPolicy(value:InputOf<typeof policyInput>) {this.effectOwner.runs++;return value.id;}
        @Server({input:policyInput,authorize:async (_value,{signal})=>{
            await new Promise<void>(resolve=>{effects.current.fileContinue=resolve;});
            return !signal.aborted;
        }})
        waitingPolicy(value:InputOf<typeof policyInput>) {this.effectOwner.runs++;return value.id;}
        @Server({input:input.object({id:input.number({coerce:true,integer:true}),file:input.file({maxBytes:16})}),authorize:policy.action('edit',policyLookup)})
        protectedFile(value:{id:number;file:File}) {this.effectOwner.runs++;return value.file.name;}
        @Server({ timeout: 80 }) async slow() { this.effectOwner.runs++; await pause(); return 'completed remotely'; }
        @Server({ timeout: 80 }) async *slowStream() {
            this.effectOwner.runs++;
            try { yield 'first'; await pause(); yield 'second'; return 'completed remotely'; }
            finally { this.effectOwner.streamsClosed++; }
        }
        @Server() async *cancelable() {
            this.effectOwner.runs++;
            try { yield 'first'; await pause(); yield 'second'; return 'completed remotely'; }
            finally { this.effectOwner.streamsClosed++; }
        }
        @Server() async unsupported() { this.effectOwner.runs++; return { nested: { callback() {} } }; }
    }
    return Actions;
}
@Page({ transport: 'http', scope:()=> 'user:anonymous' })
class HttpPage extends actions(Cossack) {
    setFixtureEnv(env: Record<string, any>) { this.env = env; }
    render() { return null as any; }
    onCleanup() { this.effectOwner.disposed++; }
}
@Page({ transport: 'sse', scope:()=> 'user:anonymous' })
class SsePage extends HttpPage {}
@Service()
class MatrixService extends actions(CossackService) {
    onDispose() { this.effectOwner.disposed++; }
}
@Page({ services: [MatrixService],scope:()=> 'user:anonymous' })
class Layout extends Cossack { render() { return null as any; } }
const httpPath = '/src/pages/http/index.ts';
const ssePath = '/src/pages/sse/index.ts';
const layoutPath = '/src/pages/layout.ts';
registry.pages[httpPath] = { default: HttpPage };
registry.pages[ssePath] = { default: SsePage };
registry.layouts[layoutPath] = { default: Layout };
const ids = computeRouteIds([httpPath, ssePath], [layoutPath]);
const { createApp } = await import('../src/router');
type Transport = 'http' | 'sse' | 'websocket' | 'service';

function clientSurface(constructor: any, transport: Transport) {
    const client: any = {
        constructor, count: 0, loading: {}, websockets: new Map(), __cossack_proxies: new Map(),
        _optimisticLockedKeys: {}, _optimisticPendingState: {},
        getInitialStateFromWindow: () => ({ componentRouteId: ids.routePathToIdMap.get(transport === 'sse' ? ssePath : httpPath), transport, scopeKey: 'user:anonymous' }),
        getPublicState: () => ({ count: client.count }),
        getProperty(key: string) { return client[key]; },
        consume() {}, hasMethod: () => false, getMethod() {}, _isOptimisticLocked: () => false,
        setProperty(key: string, value: unknown) { client[key] = value; }, requestUpdate() {},
    };
    return client;
}

async function harness(transport: Transport, uploadMode = false) {
    const environment: Record<string, any> = { APP_URL: 'http://localhost' };
    const owner = effects.current;
    const app = createApp();
    const requests: any[] = [];
    const responses: Response[] = [];
    const serverJobs: Promise<unknown>[] = [];
    let disconnected = false;
    let breakStream: (() => void) | undefined;
    let server: HttpPage | undefined;
    let scope: ServiceScope | undefined;
    let off: (() => void) | undefined;
    let socket: any;
    let damage: ((frame: any) => any) | undefined;
    let damageAt = 0;
    let jsonDamage: ((data: any) => any) | undefined;
    const rewrite = (frame: any) => {
        // WebSocket initialization/broadcasts share the socket. Only alter the
        // correlated action protocol, never an unrelated state snapshot.
        if (!damage || typeof frame.requestId !== 'string' || damageAt-- > 0) return frame;
        const change = damage; damage = undefined; return change(frame);
    };
    const browserWindow = { location: { search: '', href: '' } };
    const client = clientSurface(HttpPage, transport);
    let target = client;
    vi.stubGlobal('window', browserWindow);
    for (const name of ['Node', 'Window', 'FileList']) vi.stubGlobal(name, class {});

    if (transport === 'websocket') {
        server = createInstance(HttpPage) as HttpPage;
        server.setFixtureEnv(environment);
        server.__cossack_rpcOwner = httpPath;
        server.connectedCallback();
        let peerContext!:Context;
        const peerApp=new Hono();peerApp.get('/peer',c=>{peerContext=c;return new Response(null);});
        await peerApp.fetch(new Request('http://localhost/peer'),environment);
        const runtime = new InMemoryWebSocketRuntime(server,{getUser:()=>environment.TEST_POLICY_USER,getContext:()=>peerContext});
        const peer = { readyState: 1, send(data: string) {
            if (!disconnected) routeSocketFrame(socket, rewrite(JSON.parse(data)));
        } };
        socket = { readyState: 1, send(data: string) {
            const frame = JSON.parse(data);
            if (frame.type === 'action') requests.push(frame);
            const job = runtime.onClientMessage(peer, data);
            serverJobs.push(job);
            void job.catch(() => {});
        } };
        runtime.addClient(peer);
        vi.stubGlobal('WebSocket', Object.assign(class {}, { OPEN: 1 }));
        client.websockets.set('page', socket);
        proxyServerMethods(client, Object.keys(Reflect.getMetadata('cossack:server-methods', HttpPage))
            .map(name => ({ name, channel: 'global', provider: 'page' })));
    } else {
        vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
            if (init.body instanceof FormData) {
                const fields = Object.fromEntries(init.body.entries());
                requests.push({ ...fields, payload: JSON.parse(fields.payload as string), ...(fields.service ? { service: JSON.parse(fields.service as string) } : {}) });
            } else requests.push(JSON.parse(init.body as string));
            // ServiceScope installs browser proxies based on window presence.
            // Server scope construction must execute in its native environment.
            vi.stubGlobal('window', undefined);
            const job = Promise.resolve(app.fetch(new Request('http://localhost' + _url, {
                ...init, headers: { ...init.headers, Origin: 'http://localhost' },
            }), environment as any));
            serverJobs.push(job);
            const response = job.finally(() => vi.stubGlobal('window', browserWindow)).then(async res => {
                responses.push(res);
                if (jsonDamage && res.headers.get('Content-Type')?.includes('application/json')) {
                    const change = jsonDamage; jsonDamage = undefined;
                    return new Response(JSON.stringify(change(await res.json())), res);
                }
                if (!res.body || !res.headers.get('Content-Type')?.includes('ndjson')) return res;
                const reader = res.body.getReader();
                const body = new ReadableStream<Uint8Array>({
                    start(controller) { breakStream = () => {
                        controller.error(new TypeError('Connection lost'));
                        const cleanup = reader.cancel().finally(() => reader.releaseLock());
                        serverJobs.push(cleanup); void cleanup.catch(() => {});
                    }; },
                    async pull(controller) {
                        const next = await reader.read();
                        if (!disconnected) {
                            if (next.done) controller.close();
                            else {
                                // The real handler emits one encoded frame per
                                // chunk. Corrupt only the network boundary.
                                const value = damage ? new TextEncoder().encode(JSON.stringify(rewrite(JSON.parse(new TextDecoder().decode(next.value)))) + '\n') : next.value;
                                controller.enqueue(value);
                            }
                        }
                    },
                    async cancel() { await reader.cancel(); reader.releaseLock(); },
                }, { highWaterMark: 0 });
                return new Response(body, res);
            });
            return new Promise<Response>((resolve, reject) => {
                const abort = () => reject(new DOMException('Aborted', 'AbortError'));
                init.signal?.addEventListener('abort', abort, { once: true });
                void response.then(resolve, reject).finally(() => init.signal?.removeEventListener('abort', abort));
            });
        });
        if (uploadMode) {
            client.fileStreamProgress = 0;
            class LoopbackXhr {
                upload: { onprogress?: (event: any) => void } = {};
                responseType = ''; responseText = ''; response: ArrayBuffer | undefined;
                readyState = 1; status = 0; statusText = '';
                onreadystatechange?: () => void; onprogress?: () => void; onload?: () => void;
                onerror?: () => void; onabort?: () => void;
                controller = new AbortController(); responseHeaders = new Headers(); requestHeaders = new Headers();
                setRequestHeader(key: string, value: string) { this.requestHeaders.set(key, value); }
                getResponseHeader(key: string) { return this.responseHeaders.get(key); }
                getAllResponseHeaders() { return [...this.responseHeaders].map(([k, v]) => `${k}: ${v}`).join('\r\n'); }
                open() {}
                abort() { this.controller.abort(); this.onabort?.(); }
                send(body: FormData) {
                    const job = (async () => {
                        try {
                            this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 });
                            const response = await fetch('/upload', { method: 'POST', body, signal: this.controller.signal, headers: Object.fromEntries(this.requestHeaders) });
                            this.status = response.status; this.statusText = response.statusText; this.responseHeaders = response.headers;
                            this.readyState = 2; this.onreadystatechange?.();
                            if (this.responseType === 'text') {
                                const reader = response.body!.getReader(); const decoder = new TextDecoder();
                                try { while (true) { const next = await reader.read(); if (next.done) break; this.responseText += decoder.decode(next.value, { stream: true }); this.readyState = 3; this.onprogress?.(); } }
                                finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
                            } else this.response = await response.arrayBuffer();
                            this.readyState = 4; this.onload?.();
                        } catch { if (!this.controller.signal.aborted) this.onerror?.(); }
                    })();
                    serverJobs.push(job);
                }
            }
            vi.stubGlobal('XMLHttpRequest', LoopbackXhr);
        }
        if (transport === 'service') {
            scope = new ServiceScope(undefined, [MatrixService], { ownerRouteId: ids.routePathToIdMap.get(layoutPath), scopeKey: 'user:anonymous' });
            target = scope.resolveDeclared(MatrixService);
            off = scope.subscribe(MatrixService, client);
        } else proxyHttpMethods(client, Object.keys(Reflect.getMetadata('cossack:server-methods', HttpPage)).map(name => ({ name })));
    }
    return {
        client, target, requests, responses,
        configureEnv(update: Record<string, any>) { Object.assign(environment, update); },
        corruptFrame(change: (frame: any) => any, after = 0) { damage = change; damageAt = after; },
        corruptJson(change: (data: any) => any) { jsonDamage = change; },
        pendingCalls: () => socket ? wsPendingCalls(socket).size : 0,
        disconnect() {
            disconnected = true;
            if (socket) { socket.readyState = 3; failPendingSocketCalls(socket); }
            else breakStream!();
        },
        async dispose() {
            owner.fileContinue?.();
            await Promise.allSettled(serverJobs);
            // Draining/cancelling owns cleanup. A cancelled client's pre-header
            // request may finish remotely; cancel that unobserved response too.
            for (const response of responses) if (!response.body?.locked) await response.body?.cancel().catch(() => {});
            if (server) await server.destroyAsync();
            off?.(); await scope?.disposeAsync();
        },
    };
}

describe.each(['http', 'sse', 'websocket', 'service'] as const)('%s shared RPC conformance', transport => {
    let wire: Awaited<ReturnType<typeof harness>>;
    beforeEach(async () => {
        __resetRateLimitForTests();
        effects.current = { runs: 0, streamsClosed: 0, disposed: 0, jsonCalls: 0, nativePulls: 0, fileContinue: undefined };
        vi.spyOn(console, 'error').mockImplementation(() => {});
        wire = await harness(transport);
    });
    afterEach(async () => { await wire.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
    const settled = () => { expect(wire.client.loading).toEqual({}); expect(wire.pendingCalls()).toBe(0); };

    it.each(['limited', 'limitedStream'] as const)('limits %s before a second mutation with correlation and cleanup', async action => {
        const first = rpc$(wire.target[action]());
        if (action === 'limitedStream') {
            const yields = []; for await (const value of first) yields.push(value);
            expect(yields).toEqual([1]);
        }
        expect(await first).toBe(action === 'limited' ? 1 : 2);
        const before = wire.target.count;
        await expect(rpc$(wire.target[action]())).rejects.toMatchObject({
            code: 'COSSACK_RPC_RATE_LIMITED', requestId: expect.any(String),
            ...(transport !== 'websocket' ? { status: 429 } : {}),
            message: action === 'limited' ? 'Try later' : 'Too Many Requests',
        });
        expect(wire.target.count).toBe(before); expect(effects.current.runs).toBe(1);
        expect(wire.requests).toHaveLength(2); settled();
        if (transport !== 'websocket') expect(wire.responses.at(-1)?.headers.get('Retry-After')).toMatch(/^\d+$/);
    });
    it('keeps separate actions in separate rate buckets', async () => {
        expect(await rpc$(wire.target.limited())).toBe(1);
        expect(await rpc$(wire.target.limitedStream())).toBe(3);
        expect(effects.current.runs).toBe(2); expect(wire.requests).toHaveLength(2); settled();
    });
    it('does not run a limited mutation when its counter store fails', async () => {
        setRateLimitStore({ hit() { throw new Error('PRIVATE_COUNTER_TOKEN'); } });
        await expect(rpc$(wire.target.limited())).rejects.toMatchObject({
            code: 'COSSACK_RPC_INTERNAL_ERROR', message: 'Internal Server Error', requestId: expect.any(String),
        });
        expect(effects.current.runs).toBe(0); expect(wire.target.count).toBe(0);
        expect(wire.requests).toHaveLength(1); settled();
    });
    it('bounds a stuck counter decision and releases the next action', async () => {
        let backendSignal!: AbortSignal;
        const hit = vi.fn((_key, _window, options) => { backendSignal = options.signal; return new Promise<any>(() => {}); });
        setRateLimitStore({ hit });
        await expect(rpc$(wire.target.limitedDeadline())).rejects.toMatchObject({ code: 'COSSACK_RPC_TIMEOUT', requestId: expect.any(String) });
        expect(backendSignal.aborted).toBe(true); expect(hit).toHaveBeenCalledTimes(1);
        expect(effects.current.runs).toBe(0); expect(wire.target.count).toBe(0); settled();
        expect(await rpc$(wire.target.echo('next'))).toBe('next'); settled();
    });
    it.each(['cancel', 'client deadline'] as const)('does not run a late mutation after %s during a counter decision', async mode => {
        let release!: (value: any) => void; let backendSignal!: AbortSignal;
        const pending = new Promise<any>(resolve => { release = resolve; });
        const hit = vi.fn((_key, _window, options) => { backendSignal = options.signal; return pending; });
        setRateLimitStore({ hit });
        const call = rpc$(mode === 'cancel' ? wire.target.limited() : wire.target.limitedClientDeadline());
        const rejection = expect(call).rejects.toMatchObject({ code: mode === 'cancel' ? 'COSSACK_RPC_CANCELLED' : 'COSSACK_RPC_TIMEOUT', requestId: expect.any(String) });
        await vi.waitFor(() => expect(hit).toHaveBeenCalledTimes(1));
        if (mode === 'cancel') await call.cancel();
        await rejection;
        await vi.waitFor(() => expect(backendSignal.aborted).toBe(true));
        // Client and server have separate globals in production. Wait for the
        // aborted HTTP response to restore this loopback's browser global.
        if (transport !== 'websocket') await vi.waitFor(() => expect(wire.responses).toHaveLength(1));
        // Prove queue progress BEFORE the uncooperative provider is released.
        expect(await rpc$(wire.target.echo('next'))).toBe('next'); settled();
        expect(effects.current.runs).toBe(1); expect(wire.target.count).toBe(0);
        release({ count: 1, resetAt: Date.now() + 60000 });
        await Promise.resolve(); await Promise.resolve();
        expect(effects.current.runs).toBe(1); expect(wire.target.count).toBe(0); settled();
    });
    it.each(['do', 'kv', 'redis', 'unknown', null])('rejects invalid backend %s before a limited mutation', async rateLimit => {
        wire.configureEnv({ rateLimit });
        await expect(rpc$(wire.target.limited())).rejects.toMatchObject({
            code: 'COSSACK_RPC_INTERNAL_ERROR', message: 'Internal Server Error', requestId: expect.any(String),
        });
        expect(effects.current.runs).toBe(0); expect(wire.target.count).toBe(0);
        expect(wire.requests).toHaveLength(1); settled();
    });
    it('repairs a missing binding without silently allowing uncounted mutations', async () => {
        wire.configureEnv({ rateLimit: 'do' });
        await expect(rpc$(wire.target.limited())).rejects.toMatchObject({ code: 'COSSACK_RPC_INTERNAL_ERROR', requestId: expect.any(String) });
        expect(effects.current.runs).toBe(0);
        let count = 0;
        wire.configureEnv({ RATE_LIMIT_DO: { idFromName: (name: string) => name,
            get: () => ({ fetch: async () => Response.json({ count: ++count, resetAt: Date.now() + 60000 }) }) } });
        expect(await rpc$(wire.target.limited())).toBe(1);
        await expect(rpc$(wire.target.limited())).rejects.toMatchObject({ code: 'COSSACK_RPC_RATE_LIMITED', requestId: expect.any(String) });
        expect(effects.current.runs).toBe(1); expect(wire.target.count).toBe(1);
        expect(wire.requests).toHaveLength(3); settled();
    });
    it.each(['invalidLimit', 'invalidRateKey', 'invalidRateOptions'])('rejects %s before counter or mutation', async action => {
        const hit = vi.fn(() => ({ count: 1, resetAt: Date.now() + 60000 })); setRateLimitStore({ hit });
        await expect(rpc$(wire.target[action]())).rejects.toMatchObject({
            code: 'COSSACK_RPC_INTERNAL_ERROR', message: 'Internal Server Error', requestId: expect.any(String),
        });
        expect(hit).not.toHaveBeenCalled(); expect(effects.current.runs).toBe(0);
        expect(wire.target.count).toBe(0); settled();
    });
    it.each(['memory', 'kv', 'custom'])('rejects unsupported %s guarantees before counter or mutation', async provider => {
        const hit = vi.fn(() => ({ count: 1, resetAt: Date.now() + 60000 }));
        const get = vi.fn(); const put = vi.fn();
        if (provider === 'kv') wire.configureEnv({ rateLimit: 'kv', RATE_LIMITS: { get, put } });
        else if (provider === 'custom') setRateLimitStore({ hit });
        await expect(rpc$(wire.target.sharedAtomicLimit())).rejects.toMatchObject({ code: 'COSSACK_RPC_INTERNAL_ERROR', requestId: expect.any(String) });
        expect(hit).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
        expect(effects.current.runs).toBe(0); expect(wire.target.count).toBe(0); settled();
    });
    it('admits a shared atomic DO declaration while retaining its spent budget', async () => {
        let count = 0;
        const fetch = vi.fn(async () => Response.json({ count: ++count, resetAt: Date.now() + 60000 }));
        wire.configureEnv({ rateLimit: 'do', RATE_LIMIT_DO: { idFromName: (name: string) => name, get: () => ({ fetch }) } });
        expect(await rpc$(wire.target.sharedAtomicLimit())).toBe(1);
        await expect(rpc$(wire.target.sharedAtomicLimit())).rejects.toMatchObject({ code: 'COSSACK_RPC_RATE_LIMITED', requestId: expect.any(String) });
        expect(fetch).toHaveBeenCalledTimes(2); expect(effects.current.runs).toBe(1); expect(wire.target.count).toBe(1); settled();
    });
    it.each([null, { count: 0, resetAt: 100 }, { count: NaN, resetAt: 100 },
        { count: 1, resetAt: Infinity }])('rejects malformed counter %j before mutation', async reply => {
        setRateLimitStore({ hit: () => reply as any });
        await expect(rpc$(wire.target.limited())).rejects.toMatchObject({
            code: 'COSSACK_RPC_INTERNAL_ERROR', message: 'Internal Server Error', requestId: expect.any(String),
        });
        expect(effects.current.runs).toBe(0); expect(wire.target.count).toBe(0); settled();
    });

    it.each([
        ['unsupported version', (frame: any) => ({ ...frame, v: 2 })],
        ['unknown frame type', (frame: any) => ({ ...frame, type: 'unexpected' })],
        ['array state', (frame: any) => ({ ...frame, state: [] })],
        ['array scope state', (frame: any) => ({ ...frame, scopeState: [] })],
        ['array field errors', (frame: any) => ({ ...frame, type: 'error', code: 'COSSACK_VALIDATION_FAILED', message: 'Invalid', fieldErrors: [] })],
        ['non-string error message', (frame: any) => ({ ...frame, type: 'error', code: 'COSSACK_FAILURE', message: 7 })],
        ['empty error code', (frame: any) => ({ ...frame, type: 'error', code: '', message: 'Invalid' })],
    ] as const)('rejects %s at the wire boundary before hydrating state', async (_name, change) => {
        wire.corruptFrame(change);
        await expect(rpc$(wire.target.stream())).rejects.toMatchObject({ code: 'COSSACK_RPC_STREAM_INVALID', requestId: expect.any(String) });
        expect(wire.target.count).toBe(0); expect(wire.requests).toHaveLength(1); expect(effects.current.runs).toBe(1); settled();
        await vi.waitFor(() => expect(effects.current.streamsClosed).toBe(1));
    });
    it('isolates a foreign response ID instead of applying its state', async () => {
        wire.corruptFrame(frame => ({ ...frame, requestId: 'foreign-request', state: { count: 999 } }));
        const call = rpc$(wire.target.stream());
        if (transport === 'websocket') {
            // Socket calls share a persistent connection; unknown IDs must not
            // poison a different pending call. Its own subsequent frames work.
            expect(await call).toEqual({ total: 2 }); expect(wire.target.count).toBe(2);
        } else {
            await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_STREAM_INVALID', requestId: expect.any(String) });
            await expect(call).rejects.not.toMatchObject({ requestId: 'foreign-request' });
            expect(wire.target.count).toBe(0);
        }
        expect(wire.requests).toHaveLength(1); settled();
    });

    it.each([0, 1, 2, 3, 4])('completes native response %s without confusing its body with state or protocol', async index => {
        const call = rpc$(wire.target.native(index));
        if (transport === 'websocket') {
            await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_HTTP_RESPONSE_REQUIRED', requestId: expect.any(String) });
        } else {
            const response = await call as Response;
            expect(response).toBeInstanceOf(Response); expect(response.bodyUsed).toBe(false);
            expect(response.headers.get('X-Custom')).toBe('kept');
            expect(response.headers.get('X-Cossack-Request-Id')).toBeTruthy();
            expect(await call).toBe(response);
            if (index === 0) { expect(response.status).toBe(201); expect(await response.json()).toEqual({ _cossack_redirect: '/wrong', _cossack_return: 'data', count: 999 }); }
            if (index === 1) { expect(response.status).toBe(202); expect(await response.text()).toBe('native text'); }
            if (index === 2) expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 255, 128]);
            if (index === 3) { expect(response.status).toBe(204); expect(response.body).toBeNull(); }
            if (index === 4) expect(await response.text()).toBe('opaque, not RPC frames');
            // Native bodies never hydrate state or trigger metadata navigation.
            expect(wire.client.count).toBe(0);
            expect(effects.current.disposed).toBeGreaterThan(0);
        }
        expect(effects.current.runs).toBe(1); expect(wire.requests).toHaveLength(1); settled();
    });
    it('drains an unobserved native response and releases request ownership', async () => {
        void wire.target.native(1);
        await vi.waitFor(() => { expect(wire.client.loading.native).toBeUndefined(); expect(effects.current.runs).toBe(1); });
        if (transport !== 'websocket') expect(effects.current.disposed).toBeGreaterThan(0);
        expect(wire.requests).toHaveLength(1); settled();
    });
    it('rejects an oversized native body with correlation and cleanup', async () => {
        await expect(rpc$(wire.target.native(5))).rejects.toMatchObject({
            code: transport === 'websocket' ? 'COSSACK_RPC_HTTP_RESPONSE_REQUIRED' : 'COSSACK_RPC_RESPONSE_TOO_LARGE', requestId: expect.any(String),
        });
        expect(wire.requests).toHaveLength(1); settled();
    });
    it('retains HTTP status and correlation on native response failures', async () => {
        await expect(rpc$(wire.target.native(6))).rejects.toMatchObject(transport === 'websocket'
            ? { code: 'COSSACK_RPC_HTTP_RESPONSE_REQUIRED', requestId: expect.any(String) }
            : { code: 'COSSACK_RPC_FAILED', status: 422, requestId: expect.any(String) });
        expect(wire.requests).toHaveLength(1); settled();
    });
    it('reports a native body disconnect with request ID and no replay', async () => {
        await expect(rpc$(wire.target.native(7))).rejects.toMatchObject({
            code: transport === 'websocket' ? 'COSSACK_RPC_HTTP_RESPONSE_REQUIRED' : 'COSSACK_RPC_NETWORK_FAILED', requestId: expect.any(String),
        });
        expect(wire.requests).toHaveLength(1); settled();
    });
    it('keeps its deadline while consuming a native body', async () => {
        await expect(rpc$(wire.target.slowNative())).rejects.toMatchObject({
            code: transport === 'websocket' ? 'COSSACK_RPC_HTTP_RESPONSE_REQUIRED' : 'COSSACK_RPC_TIMEOUT', requestId: expect.any(String),
        });
        expect(wire.requests).toHaveLength(1); settled();
    });
    it('cancels native-body consumption without replay and closes the server body', async () => {
        const call = rpc$(wire.target.slowNative());
        if (transport === 'websocket') {
            await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_HTTP_RESPONSE_REQUIRED' });
        } else {
            await vi.waitFor(() => expect(effects.current.nativePulls).toBe(2), { interval: 1 });
            await call.cancel();
            await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED', requestId: expect.any(String) });
        }
        await vi.waitFor(() => expect(effects.current.streamsClosed).toBe(1));
        expect(wire.requests).toHaveLength(1); settled();
    });
    it('retains correlation when cancelled while parked between yields', async () => {
        const call = rpc$(wire.target.cancelable()); const iterator = call[Symbol.asyncIterator]();
        await iterator.next(); await call.cancel();
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED', requestId: expect.any(String) });
        await vi.waitFor(() => expect(effects.current.streamsClosed).toBe(1));
        expect(wire.requests).toHaveLength(1); settled();
    });
    it('returns normalized dates, model fields, custom JSON, and optional/array values', async () => {
        expect(await wire.target.structured()).toEqual(expectedWireData);
        expect(effects.current.jsonCalls).toBe(1); settled();
    });
    it('normalizes yielded and terminal data independently with one hook invocation per value', async () => {
        const call = rpc$(wire.target.structuredStream()); const values = [];
        for await (const value of call) values.push(value);
        expect(values).toEqual([expectedWireData]); expect(await call).toEqual(expectedWireData);
        expect(effects.current.jsonCalls).toBe(2); settled();
    });
    it('normalizes client payloads before dispatch without invoking hooks twice', async () => {
        expect(await wire.target.echo(wireData())).toEqual(expectedWireData);
        expect(effects.current.jsonCalls).toBe(1); expect(wire.requests[0].payload).toEqual([expectedWireData]); settled();
    });
    it('preserves an own __proto__ field as payload data through upload extraction and JSON encoding', async () => {
        const value = JSON.parse('{"__proto__":{"label":"data"}}');
        expect(await wire.target.echo(value)).toEqual(value);
        expect(Object.hasOwn(wire.requests[0].payload[0], '__proto__')).toBe(true); settled();
    });
    it('uses the same root toJSON key for ordinary, yielded, and terminal results', async () => {
        expect(await wire.target.rootJson()).toEqual({ key: '' });
        const call = rpc$(wire.target.rootJsonStream()); const values = [];
        for await (const value of call) values.push(value);
        expect(values).toEqual([{ key: '' }]); expect(await call).toEqual({ key: '' }); settled();
    });
    it.each(lossyValues.map((_, index) => index))('rejects lossy result %s instead of changing or dropping it', async index => {
        await expect(Promise.resolve(wire.target.lossy(index))).rejects.toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED', requestId: expect.any(String), message: expect.stringContaining('value.invalid') });
        expect(wire.requests).toHaveLength(1); settled();
    });
    it.each(lossyValues)('rejects lossy argument %s before mutation', async value => {
        await expect(Promise.resolve(wire.target.echo(value))).rejects.toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED', message: expect.stringContaining('payload[0]') });
        expect(wire.requests).toHaveLength(0); expect(effects.current.runs).toBe(0); settled();
    });

    it('returns ordinary data without yields and repeated awaits never redispatch', async () => {
        const call = rpc$(wire.target.ordinary(3));
        const values = []; for await (const value of call) values.push(value);
        expect(values).toEqual([]);
        expect(await call).toEqual({ count: 3 }); expect(await call).toEqual({ count: 3 });
        expect(wire.target.count).toBe(3); expect(wire.requests).toHaveLength(1); expect(effects.current.runs).toBe(1); settled();
    });
    it('drains an unobserved action and releases loading without another dispatch', async () => {
        wire.target.ordinary(4);
        await expect.poll(() => wire.target.count).toBe(4);
        await expect.poll(() => Object.keys(wire.client.loading)).toEqual([]);
        expect(wire.requests).toHaveLength(1); expect(effects.current.runs).toBe(1);
    });
    it('releases request ownership after completion while WebSocket ownership lasts until teardown', async () => {
        await wire.target.stream();
        expect(effects.current.streamsClosed).toBe(1);
        expect(effects.current.disposed).toBe(transport === 'websocket' ? 0 : transport === 'service' ? 1 : 2);
    });
    it('streams yields and terminal data separately, applies state, and closes the generator once', async () => {
        const call = rpc$(wire.target.stream());
        const values = []; for await (const value of call) values.push(value);
        expect(values).toEqual([{ count: 1 }, { count: 2 }]);
        expect(await call).toEqual({ total: 2 }); expect(wire.target.count).toBe(2);
        expect(effects.current.streamsClosed).toBe(1); expect(wire.requests).toHaveLength(1); settled();
    });
    it.each([['visible', 'COSSACK_RPC_CLIENT_ERROR', 'Prompt required'], ['internal', 'COSSACK_RPC_INTERNAL_ERROR', 'Internal Server Error']])('correlates and redacts %s errors', async (action, code, message) => {
        await expect(Promise.resolve(wire.target[action]())).rejects.toMatchObject({ code, message, requestId: expect.any(String) });
        expect(wire.requests).toHaveLength(1); expect(effects.current.runs).toBe(1); settled();
    });
    if (transport !== 'websocket') {
        const expectedRoute = transport === 'service' ? layoutPath : transport === 'sse' ? ssePath : httpPath;
        const loggedEvents = () => vi.mocked(console.error).mock.calls.map(([value]) => value)
            .filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null &&
                (value as Record<string, unknown>).event === 'cossack.rpc.failure');
        it('logs internal action failures with searchable, redacted correlation fields', async () => {
            const failure = await Promise.resolve(wire.target.internal()).catch(error => error);
            expect(failure).toMatchObject({ code: 'COSSACK_RPC_INTERNAL_ERROR', requestId: expect.any(String) });
            const events = loggedEvents();
            const event = events.find(candidate => candidate.requestId === failure.requestId);
            expect(event).toMatchObject({ event: 'cossack.rpc.failure', requestId: failure.requestId,
                route: expectedRoute, action: 'internal', runtime: expect.any(String), stage: 'action',
                code: 'COSSACK_RPC_INTERNAL_ERROR', durationMs: expect.any(Number) });
            expect(Number.isFinite(event?.durationMs)).toBe(true);
            expect(JSON.stringify(events)).not.toContain('PRIVATE_TOKEN');
            expect(wire.requests).toHaveLength(1); expect(effects.current.runs).toBe(1); settled();
        });
        it('keeps stream failure logs correlated and free of thrown error details', async () => {
            const call = rpc$(wire.target.internalStream());
            const iterator = call[Symbol.asyncIterator]();
            const failure = await iterator.next().catch(error => error);
            expect(failure).toMatchObject({ code: 'COSSACK_RPC_INTERNAL_ERROR', requestId: expect.any(String) });
            await expect(call).rejects.toBeDefined();
            const events = loggedEvents();
            expect(events.find(candidate => candidate.requestId === failure.requestId)).toMatchObject({
                requestId: failure.requestId, route: expectedRoute, action: 'internalStream',
                stage: 'stream', code: 'COSSACK_RPC_INTERNAL_ERROR', durationMs: expect.any(Number),
            });
            expect(JSON.stringify(events)).not.toContain('PRIVATE_TOKEN');
            expect(wire.requests).toHaveLength(1); expect(effects.current.runs).toBe(1); settled();
        });
    }
    it('validates before application mutation with correlated field errors', async () => {
        await expect(Promise.resolve(wire.target.validated({}))).rejects.toMatchObject({ code: 'COSSACK_VALIDATION_FAILED', requestId: expect.any(String), fieldErrors: { title: expect.any(String) } });
        expect(effects.current.runs).toBe(0); settled();
    });
    it('normalizes nested typed input before mutation without mutating client values', async () => {
        const raw = {profile:{age:'2'},enabled:'false',tags:['draft']};
        expect(await rpc$(wire.target.normalized(raw))).toEqual({profile:{age:2},enabled:false,tags:['draft']});
        expect(raw.profile.age).toBe('2'); expect(effects.current.runs).toBe(1); settled();
    });
    it('validates typed function fields before invocation and keeps parsed input',async()=>{
        await expect(rpc$(wire.target.normalizedField({profile:{age:'bad'},enabled:true,tags:[]})))
            .rejects.toMatchObject({code:'COSSACK_VALIDATION_FAILED',fieldErrors:{profile:{age:expect.any(String)}},requestId:expect.any(String)});
        expect(effects.current.runs).toBe(0);
        expect(await rpc$(wire.target.normalizedField({profile:{age:'3'},enabled:'false',tags:['draft']})))
            .toEqual({profile:{age:3},enabled:false,tags:['draft']});
        expect(effects.current.runs).toBe(1);settled();
    });
    it('rejects obsolete action rule maps before mutation without exposing migration errors',async()=>{
        await expect(rpc$(wire.target.oldInput({profile:1,canEdit:true})))
            .rejects.toMatchObject({code:'COSSACK_RPC_INTERNAL_ERROR',message:'Internal Server Error',requestId:expect.any(String)});
        expect(effects.current.runs).toBe(0);settled();
    });
    it.each([
        [{profile:{age:'0'},enabled:true,tags:[]}, {profile:{age:'Minimum value is 1'}}],
        [{profile:{age:'bad'},enabled:true,tags:['admin']}, {profile:{age:'Expected a safe integer.'},tags:{0:'Unexpected value.'}}],
        [{profile:{age:2,canEdit:true},enabled:true,tags:[]}, {profile:{canEdit:'Unknown field.'}}],
        [{profile:{age:2},enabled:'maybe',tags:[]}, {enabled:'Expected a boolean.'}],
        [{profile:{age:2},enabled:true,tags:'draft'}, {tags:'Expected an array.'}],
        [{profile:{age:2},enabled:true,tags:[],note:null}, {note:'Expected a string.'}],
        [null, {_:'Expected an object.'}],
    ])('rejects forged typed input with nested errors before any mutation (%#)', async (raw, fieldErrors) => {
        await expect(rpc$(wire.target.normalized(raw))).rejects.toMatchObject({code:'COSSACK_VALIDATION_FAILED',fieldErrors,requestId:expect.any(String)});
        expect(effects.current.runs).toBe(0); settled();
    });
    it('rejects excess typed arguments instead of letting callers bypass the contract', async () => {
        await expect(rpc$(wire.target.normalized({profile:{age:2},enabled:true,tags:[]},'forged')))
            .rejects.toMatchObject({code:'COSSACK_VALIDATION_FAILED',fieldErrors:{_:'This action accepts one input argument.'}});
        expect(effects.current.runs).toBe(0); settled();
    });
    it('redacts unexpected validator exceptions and runs no mutation', async () => {
        await expect(rpc$(wire.target.brokenValidation('x'))).rejects.toMatchObject({code:'COSSACK_RPC_INTERNAL_ERROR',message:'Internal Server Error',requestId:expect.any(String)});
        expect(effects.current.runs).toBe(0); settled();
    });
    it.each(['publicValidationException','publicPolicyException'])('keeps public exception classes private inside %s',async action=>{
        for(const index of [0,1,2]){
            await expect(rpc$(wire.target[action](index))).rejects.toMatchObject({code:'COSSACK_RPC_INTERNAL_ERROR',message:'Internal Server Error',requestId:expect.any(String)});
            expect(effects.current.runs).toBe(0);
        }
        settled();
    });
    it('cancels a pending schema callback before mutation and releases the next request', async () => {
        const call=rpc$(wire.target.waitingValidation('x'));
        const rejection=expect(call).rejects.toMatchObject({code:'COSSACK_RPC_CANCELLED'});
        await vi.waitFor(() => expect(effects.current.fileContinue).toBeTypeOf('function'));
        await call.cancel(); await rejection;
        if(transport!=='websocket') {
            await vi.waitFor(() => expect(wire.responses).toHaveLength(1));
            expect(wire.responses[0].status).toBe(499);
            expect(wire.responses[0].headers.get('X-Cossack-Request-Id')).toEqual(expect.any(String));
            expect(await wire.responses[0].clone().json()).toMatchObject({code:'COSSACK_RPC_CANCELLED', requestId:wire.responses[0].headers.get('X-Cossack-Request-Id')});
        }
        expect(await rpc$(wire.target.echo('next'))).toBe('next');
        expect(effects.current.runs).toBe(1); settled();
    });
    it('allows an owned record using normalized input and request identity',async()=>{
        policyLookup.mockClear();wire.configureEnv({TEST_POLICY_USER:{id:'u1',tenant:'t1'}});
        expect(await rpc$(wire.target.protectedMutation({id:'1'}))).toBe(1);
        expect(policyLookup).toHaveBeenCalledWith({id:1},expect.objectContaining({context:expect.any(Object),signal:expect.any(AbortSignal)}));
        expect(effects.current.runs).toBe(1);settled();
    });
    it.each([
        [{id:'u1',tenant:'t1'},2,'COSSACK_AUTH_FORBIDDEN'],
        [{id:'u1',tenant:'t1'},3,'COSSACK_AUTH_FORBIDDEN'],
        [{id:'u1',tenant:'t1'},999,'COSSACK_AUTH_FORBIDDEN'],
        [undefined,1,'COSSACK_AUTH_UNAUTHENTICATED'],
    ])('rejects record/tenant/anonymous access despite forged client permissions (%#)',async(actor,id,code)=>{
        wire.configureEnv({TEST_POLICY_USER:actor});
        wire.client.getPublicState=()=>({count:0,canEdit:true,user:{id:'u1',tenant:'t1'},owner:'u1'});
        await expect(rpc$(wire.target.protectedMutation({id}))).rejects.toMatchObject({code,requestId:expect.any(String),
            ...(transport!=='websocket'?{status:actor?403:401}:{})});
        expect(effects.current.runs).toBe(0);settled();
    });
    it('validates before a resource lookup/policy and never trusts ownership in the payload',async()=>{
        wire.configureEnv({TEST_POLICY_USER:{id:'u1',tenant:'t1'}});policyLookup.mockClear();
        await expect(rpc$(wire.target.protectedMutation({id:1,owner:'u1',canEdit:true}))).rejects.toMatchObject({code:'COSSACK_VALIDATION_FAILED'});
        expect(policyLookup).not.toHaveBeenCalled();expect(effects.current.runs).toBe(0);settled();
    });
    it('keeps unexpected policy failures private and runs no mutation',async()=>{
        await expect(rpc$(wire.target.brokenPolicy({id:1}))).rejects.toMatchObject({code:'COSSACK_RPC_INTERNAL_ERROR',message:'Internal Server Error'});
        expect(effects.current.runs).toBe(0);settled();
    });
    it('releases an aborted policy before its callback finishes and skips mutation',async()=>{
        const call=rpc$(wire.target.waitingPolicy({id:1}));const rejection=expect(call).rejects.toMatchObject({code:'COSSACK_RPC_CANCELLED'});
        await vi.waitFor(()=>expect(effects.current.fileContinue).toBeTypeOf('function'));
        await call.cancel();await rejection;
        if(transport!=='websocket')await vi.waitFor(()=>expect(wire.responses).toHaveLength(1));
        expect(await rpc$(wire.target.echo('next'))).toBe('next');expect(effects.current.runs).toBe(1);settled();
        effects.current.fileContinue!();await Promise.resolve();await Promise.resolve();expect(effects.current.runs).toBe(1);
    });
    it('preserves yields before a correlated application failure and closes once', async () => {
        const call = rpc$(wire.target.streamError());
        const iterator = call[Symbol.asyncIterator]();
        expect(await iterator.next()).toEqual({ done: false, value: 'first' });
        await expect(iterator.next()).rejects.toMatchObject({ code: 'COSSACK_RPC_CLIENT_ERROR', requestId: expect.any(String), message: 'Rejected after progress' });
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CLIENT_ERROR' });
        expect(effects.current.streamsClosed).toBe(1); expect(effects.current.runs).toBe(1); settled();
    });
    it('shares catch/finally completion handlers without repeating the failed mutation', async () => {
        const call = rpc$(wire.target.visible()); const finished = vi.fn();
        const recovered = call.catch(error => error.code);
        const finalized = call.finally(finished).catch(error => error.code);
        expect(await recovered).toBe('COSSACK_RPC_CLIENT_ERROR');
        expect(await finalized).toBe('COSSACK_RPC_CLIENT_ERROR');
        expect(finished).toHaveBeenCalledOnce(); expect(wire.requests).toHaveLength(1); settled();
    });
    it.each(['slow', 'slowStream'])('enforces %s deadlines without retry or leaked loading', async action => {
        await expect(Promise.resolve(wire.target[action]())).rejects.toMatchObject({ code: 'COSSACK_RPC_TIMEOUT', message: expect.stringContaining('outcome is unknown') });
        expect(wire.requests).toHaveLength(1); expect(effects.current.runs).toBe(1); settled();
    });
    it('retains the request ID when a deadline expires after progress', async () => {
        const call = rpc$(wire.target.slowStream()); const iterator = call[Symbol.asyncIterator]();
        expect(await iterator.next()).toEqual({ done: false, value: 'first' });
        await expect(iterator.next()).rejects.toMatchObject({ code: 'COSSACK_RPC_TIMEOUT', requestId: expect.any(String) });
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_TIMEOUT' }); settled();
    });
    it('cancels after a yield, rejects completion, and eventually closes remote work', async () => {
        const call = rpc$(wire.target.cancelable()); const iterator = call[Symbol.asyncIterator]();
        expect(await iterator.next()).toEqual({ done: false, value: 'first' });
        await call.cancel(); await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
        await expect.poll(() => effects.current.streamsClosed).toBe(1);
        expect(wire.requests).toHaveLength(1); settled();
    });
    it('rejects a second iterator without losing the first or redispatching', async () => {
        const call = rpc$(wire.target.stream()); const iterator = call[Symbol.asyncIterator]();
        expect(() => call[Symbol.asyncIterator]()).toThrow(expect.objectContaining({ code: 'COSSACK_RPC_ALREADY_CONSUMED' }));
        expect((await iterator.next()).value).toEqual({ count: 1 });
        expect((await iterator.next()).value).toEqual({ count: 2 });
        expect((await iterator.next()).done).toBe(true);
        expect(await call).toEqual({ total: 2 }); expect(wire.requests).toHaveLength(1); settled();
    });
    it('cancels on iterator return and releases the remote generator', async () => {
        const call = rpc$(wire.target.cancelable()); const iterator = call[Symbol.asyncIterator]();
        expect(await iterator.next()).toEqual({ done: false, value: 'first' });
        expect(await iterator.return!()).toMatchObject({ done: true });
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
        await expect.poll(() => effects.current.streamsClosed).toBe(1); expect(wire.requests).toHaveLength(1); settled();
    });
    it('rejects unsupported return values with a correlated path', async () => {
        await expect(Promise.resolve(wire.target.unsupported())).rejects.toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED', requestId: expect.any(String), message: expect.stringContaining('value.nested.callback') });
        expect(wire.requests).toHaveLength(1); settled();
    });
    it('rejects unsupported input before dispatching a mutation', async () => {
        await expect(Promise.resolve(wire.target.ordinary({ nested: new Map() }))).rejects.toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED', message: expect.stringContaining('payload[0].nested') });
        expect(wire.requests).toHaveLength(0); expect(effects.current.runs).toBe(0); settled();
    });
    it('rejects unsupported public state before dispatching a mutation', async () => {
        wire.target.count = new Map();
        await expect(Promise.resolve(wire.target.ordinary(1))).rejects.toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED', message: expect.stringContaining('state.count') });
        expect(wire.requests).toHaveLength(0); expect(effects.current.runs).toBe(0); settled();
    });
    it('reports disconnect uncertainty without replaying a mutation', async () => {
        const call = rpc$(wire.target.cancelable()); const iterator = call[Symbol.asyncIterator]();
        expect(await iterator.next()).toEqual({ done: false, value: 'first' });
        wire.disconnect();
        await expect(iterator.next()).rejects.toMatchObject({ code: transport === 'websocket' ? 'COSSACK_RPC_TRANSPORT_CLOSED' : 'COSSACK_RPC_NETWORK_FAILED', message: expect.stringContaining('unknown'), requestId: expect.any(String) });
        await expect(call).rejects.toBeDefined(); expect(wire.requests).toHaveLength(1); settled();
    });
});

describe.each(['http', 'sse', 'service'] as const)('%s response-local protocol boundaries', transport => {
    let wire: Awaited<ReturnType<typeof harness>>;
    beforeEach(async () => {
        effects.current = { runs: 0, streamsClosed: 0, disposed: 0, jsonCalls: 0, nativePulls: 0, fileContinue: undefined };
        vi.spyOn(console, 'error').mockImplementation(() => {});
        wire = await harness(transport);
    });
    afterEach(async () => { await wire.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
    it.each([
        ['numeric redirect', (data: any) => ({ ...data, _cossack_redirect: 7 })],
        ['blank redirect', (data: any) => ({ _cossack_redirect: ' ' })],
        ['executable redirect', (data: any) => ({ _cossack_redirect: 'javascript:alert(1)' })],
        ['redirect with conflicting result', (data: any) => ({ ...data, _cossack_redirect: '/next' })],
        ['wrong service-state shape', (data: any) => ({ ...data, _cossack_service_state: [] })],
    ] as const)('rejects %s before hydration or navigation', async (_name, change) => {
        wire.corruptJson(change);
        await expect(rpc$(wire.target.ordinary(1))).rejects.toMatchObject({ code: 'COSSACK_RPC_RESPONSE_INVALID', requestId: expect.any(String) });
        expect(wire.target.count).toBe(0); expect(wire.client.loading).toEqual({});
        expect(wire.requests).toHaveLength(1); expect(effects.current.runs).toBe(1);
        expect(window.location.href).toBe('');
    });
    it.each([
        ['numeric error code', (data: any) => ({ ...data, code: 7 })],
        ['blank error code', (data: any) => ({ ...data, code: ' ' })],
        ['numeric error message', (data: any) => ({ ...data, error: 7 })],
        ['array field errors', (data: any) => ({ ...data, fieldErrors: [] })],
        ['null field errors', (data: any) => ({ ...data, fieldErrors: null })],
        ['foreign diagnostic ID', (data: any) => ({ ...data, requestId: 'foreign-request' })],
    ] as const)('rejects %s without accepting malformed HTTP diagnostics', async (_name, change) => {
        wire.corruptJson(change);
        const call = rpc$(wire.target.visible());
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_RESPONSE_INVALID', status: 400, requestId: expect.any(String) });
        await expect(call).rejects.not.toMatchObject({ requestId: 'foreign-request' });
        expect(wire.target.count).toBe(0); expect(wire.client.loading).toEqual({});
        expect(wire.requests).toHaveLength(1); expect(effects.current.runs).toBe(1);
    });
    if (transport === 'service') it.each([null, undefined])('requires service state on ordinary completion (%j)', async state => {
        wire.corruptJson(data => ({ ...data, _cossack_service_state: state }));
        await expect(rpc$(wire.target.ordinary(1))).rejects.toMatchObject({ code: 'COSSACK_RPC_RESPONSE_INVALID', requestId: expect.any(String) });
        expect(wire.target.count).toBe(0); expect(wire.client.loading).toEqual({}); expect(wire.requests).toHaveLength(1);
    });
    it('rejects terminal-following data before applying a false final state', async () => {
        wire.corruptFrame(frame => ({ ...frame, type: 'done', value: 'premature', state: { count: 999 } }));
        await expect(rpc$(wire.target.stream())).rejects.toMatchObject({ code: 'COSSACK_RPC_STREAM_INVALID', requestId: expect.any(String) });
        expect(wire.target.count).toBe(0); expect(wire.requests).toHaveLength(1); expect(wire.client.loading).toEqual({});
        await vi.waitFor(() => expect(effects.current.streamsClosed).toBe(1));
    });
    it('retains correlation and accepted progress when a later frame is malformed', async () => {
        wire.corruptFrame(frame => ({ ...frame, v: 2, state: { count: 999 } }), 1);
        const call = rpc$(wire.target.stream()); const iterator = call[Symbol.asyncIterator]();
        expect(await iterator.next()).toEqual({ done: false, value: { count: 1 } });
        await expect(iterator.next()).rejects.toMatchObject({ code: 'COSSACK_RPC_STREAM_INVALID', requestId: expect.any(String) });
        await expect(call).rejects.toBeDefined(); expect(wire.target.count).toBe(1);
        expect(wire.requests).toHaveLength(1); expect(wire.client.loading).toEqual({});
    });
});

describe('HTTP and socket action budget ownership', () => {
    it('does not regain a page budget by switching from JSON HTTP to WebSocket', async () => {
        __resetRateLimitForTests();
        effects.current = { runs: 0, streamsClosed: 0, disposed: 0, jsonCalls: 0, nativePulls: 0, fileContinue: undefined };
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const http = await harness('http'); let socket: Awaited<ReturnType<typeof harness>> | undefined;
        try {
            expect(await rpc$(http.target.limited())).toBe(1);
            socket = await harness('websocket');
            await expect(rpc$(socket.target.limited())).rejects.toMatchObject({ code: 'COSSACK_RPC_RATE_LIMITED', requestId: expect.any(String) });
            expect(socket.target.count).toBe(0); expect(effects.current.runs).toBe(1);
            expect(socket.requests).toHaveLength(1); expect(socket.client.loading).toEqual({}); expect(socket.pendingCalls()).toBe(0);
        } finally { await socket?.dispose(); await http.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
    });
});

describe('multipart upload JSON values', () => {
    afterEach(() => vi.restoreAllMocks());
    const upload = (action: string, payload: unknown[] = []) => {
        const body = new FormData();
        body.set('componentRouteId', ids.routePathToIdMap.get(httpPath)!);
        body.set('action', action); body.set('payload', JSON.stringify(payload));
        body.set('file_test', new Blob(['hello']), 'test.txt');
        return createApp().request('/upload', { method: 'POST', body, headers: { Origin: 'http://localhost' } }, { APP_URL: 'http://localhost' } as any);
    };
    it.each([
        ['missing file', '[{"_cossack_file_id":"file_0"}]'],
        ['invalid marker', '[{"_cossack_file_id":"componentRouteId"}]'],
        ['marker with extra data', '[{"_cossack_file_id":"file_0","other":true}]'],
        ['non-array payload', '{}'], ['null payload', 'null'], ['bad JSON', '{'],
    ])('rejects %s before action construction or mutation', async (_name, payload) => {
        effects.current.runs = 0; effects.current.disposed = 0;
        const body = new FormData(); body.set('componentRouteId', ids.routePathToIdMap.get(httpPath)!);
        body.set('action', 'ordinary'); body.set('payload', payload);
        const response = await createApp().request('/upload', { method: 'POST', body, headers: { Origin: 'http://localhost' } });
        expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: 'COSSACK_RPC_REQUEST_INVALID', requestId: response.headers.get('X-Cossack-Request-Id') });
        expect(effects.current.runs).toBe(0); expect(effects.current.disposed).toBe(0);
    });
    it('rejects duplicate metadata and duplicate file parts instead of choosing one', async () => {
        for (const duplicate of ['payload', 'file_0']) {
            effects.current.runs = 0;
            const body = new FormData(); body.set('componentRouteId', ids.routePathToIdMap.get(httpPath)!); body.set('action', 'ordinary');
            body.set('payload', '[{"_cossack_file_id":"file_0"}]'); body.set('file_0', new File(['one'], 'one.txt'));
            body.append(duplicate, duplicate === 'payload' ? '[]' : new File(['two'], 'two.txt'));
            const response = await createApp().request('/upload', { method: 'POST', body, headers: { Origin: 'http://localhost' } });
            expect(response.status).toBe(400); expect((await response.json() as any).code).toBe('COSSACK_RPC_REQUEST_INVALID'); expect(effects.current.runs).toBe(0);
        }
    });
    it('normalizes native JSON data and invokes hooks once on ordinary results', async () => {
        effects.current.jsonCalls = 0;
        const response = await upload('structured');
        expect(response.status).toBe(200); expect(response.headers.get('X-Cossack-Request-Id')).toBeTruthy();
        expect(await response.json()).toMatchObject({ _cossack_return: expectedWireData });
        expect(effects.current.jsonCalls).toBe(1);
    });
    it.each([0, 1, 2, 3])('rejects lossy upload result %s with a correlated path', async index => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const response = await upload('lossy', [index]);
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED',
            requestId: response.headers.get('X-Cossack-Request-Id'), error: expect.stringContaining('value.invalid') });
    });
    it('keeps private upload exceptions in server logs even in development', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const response = await upload('internal');
        expect(await response.json()).toMatchObject({ code: 'COSSACK_RPC_INTERNAL_ERROR', error: 'Internal Server Error' });
    });
});


describe.each(['http', 'sse', 'service'] as const)('%s multipart client/router conformance', transport => {
    let wire: Awaited<ReturnType<typeof harness>>;
    const input = () => ({ title: 'valid', nested: { files: [new File(['hello'], 'first.txt'), new File(['world'], 'second.txt')] } });
    beforeEach(async () => {
        effects.current = { runs: 0, streamsClosed: 0, disposed: 0, jsonCalls: 0, nativePulls: 0, fileContinue: undefined };
        vi.spyOn(console, 'error').mockImplementation(() => {});
        wire = await harness(transport, true);
    });
    afterEach(async () => { await wire.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
    it('restores nested files before validation and uses the same scoped dispatcher', async () => {
        wire.client.fileInfoProgress = 0;
        const call = rpc$(wire.target.fileInfo(input()));
        expect(await call).toEqual({ title: 'valid', files: [{ name: 'first.txt', text: 'hello' }, { name: 'second.txt', text: 'world' }], path: '/upload' });
        expect(await call).toBe(await call); expect(effects.current.runs).toBe(1); expect(effects.current.disposed).toBeGreaterThan(0);
        expect(wire.requests).toHaveLength(1); expect(wire.client.loading).toEqual({});
        if (transport !== 'service') expect(wire.client.fileInfoProgress).toBe(100);
    });
    it('uses streaming Fetch for file calls without a numeric progress field', async () => {
        delete wire.client.fileStreamProgress;
        const call = rpc$(wire.target.fileStream(input())); const iterator = call[Symbol.asyncIterator]();
        expect(await iterator.next()).toEqual({ done: false, value: 'hello' });
        expect(effects.current.streamsClosed).toBe(0);
        const pending = iterator.next(); await vi.waitFor(() => expect(effects.current.fileContinue).toBeTypeOf('function')); effects.current.fileContinue!();
        expect(await pending).toEqual({ done: true, value: 2 }); expect(await call).toBe(2); expect(wire.requests).toHaveLength(1);
    });
    it('rejects invalid file-form input before mutation with correlated field errors', async () => {
        const data = input(); data.title = '';
        await expect(rpc$(wire.target.fileInfo(data))).rejects.toMatchObject({ code: 'COSSACK_VALIDATION_FAILED', fieldErrors: { title: expect.any(String) }, requestId: expect.any(String) });
        expect(effects.current.runs).toBe(0); expect(effects.current.disposed).toBeGreaterThan(0); expect(wire.client.loading).toEqual({});
    });
    it('rejects forged file metadata and oversize uploads before mutation', async () => {
        for(const files of [[{name:'forged',size:1}], [new File(['x'.repeat(17)],'large.txt')]]) {
            await expect(rpc$(wire.target.fileInfo({title:'valid',nested:{files}})))
                .rejects.toMatchObject({code:'COSSACK_VALIDATION_FAILED',fieldErrors:{nested:{files:{0:expect.any(String)}}},requestId:expect.any(String)});
        }
        expect(effects.current.runs).toBe(0); expect(wire.client.loading).toEqual({});
    });
    it('enforces the same resource policy before an uploaded mutation',async()=>{
        wire.configureEnv({TEST_POLICY_USER:{id:'u1',tenant:'t1'}});
        for(const id of [2,3])await expect(rpc$(wire.target.protectedFile({id,file:new File(['safe'],'owned.txt')})))
            .rejects.toMatchObject({code:'COSSACK_AUTH_FORBIDDEN',status:403,requestId:expect.any(String)});
        expect(effects.current.runs).toBe(0);
        expect(await rpc$(wire.target.protectedFile({id:1,file:new File(['safe'],'owned.txt')}))).toBe('owned.txt');
        expect(effects.current.runs).toBe(1);expect(wire.client.loading).toEqual({});
    });
    it('yields before the upload generator completes and preserves state/final result', async () => {
        const call = rpc$(wire.target.fileStream(input())); const iterator = call[Symbol.asyncIterator]();
        expect(await iterator.next()).toEqual({ done: false, value: 'hello' });
        expect(effects.current.streamsClosed).toBe(0); expect(effects.current.disposed).toBe(0);
        const pending = iterator.next();
        await vi.waitFor(() => expect(effects.current.fileContinue).toBeTypeOf('function')); effects.current.fileContinue!();
        expect(await pending).toEqual({ done: true, value: 2 }); expect(await call).toBe(2);
        expect(effects.current.streamsClosed).toBe(1); expect(effects.current.disposed).toBeGreaterThan(0); expect(wire.client.loading).toEqual({});
    });
    it('cancels upload response consumption and eventually closes request ownership', async () => {
        const call = rpc$(wire.target.fileStream(input())); const iterator = call[Symbol.asyncIterator]();
        await iterator.next(); await call.cancel();
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED', requestId: expect.any(String) });
        await vi.waitFor(() => expect(effects.current.streamsClosed).toBe(1));
        await vi.waitFor(() => expect(effects.current.disposed).toBe(transport === 'service' ? 1 : 2)); expect(wire.client.loading).toEqual({});
    });
});
