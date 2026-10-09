import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyHttpMethods } from '../src/shared/method-proxy';
import { connectSSE } from '../src/shared/transport-connections';
import { optimistic } from '../src/shared/optimistic';
import { noteOptimisticWrite } from '../src/shared/optimistic-state';
import { RPC_STREAM_CONTENT_TYPE } from '../src/shared/rpc-stream';

class Source {
    static CLOSED = 2;
    static latest: Source;
    readyState = 1;
    onopen?: () => void;
    onerror?: () => void;
    listeners = new Map<string, (event: unknown) => void>();
    constructor(_url: string) { Source.latest = this; }
    addEventListener(type: string, listener: (event: unknown) => void) { this.listeners.set(type, listener); }
    state(count: number, cursor: number, requestId?: string) {
        this.listeners.get('state-update')?.({ lastEventId: String(cursor), data: JSON.stringify({ count,
            ...(requestId ? { _cossack_request_id: requestId } : {}) }) });
    }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function fixture() {
    const requests: Array<{ id: string; resolve: (response: Response) => void }> = [];
    vi.stubGlobal('EventSource', Source);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>(resolve => {
        requests.push({ id: new Headers(init.headers).get('X-Cossack-Request-Id')!, resolve });
    })));
    const target: any = { constructor: class Counter {}, count: 0, draft: 'draft', loading: {},
        _optimisticLockedKeys: {}, _optimisticPendingState: {}, __cossack_proxies: new Map(), requestUpdate: vi.fn(),
        getInitialStateFromWindow: () => ({ componentRouteId: 'counter', scopeKey: 'one', transport: 'sse' }),
        getPublicState() { return { count: this.count }; },
        getMethod: () => () => optimistic(target).increment('count', 1), hasMethod: () => true,
        setProperty(key: string, value: unknown) { this[key] = value; noteOptimisticWrite(this, key); },
        _isOptimisticLocked: () => false,
    };
    Reflect.defineMetadata('cossack:state', { count: {} }, target.constructor);
    Reflect.defineMetadata('cossack:optimistic-handlers', { edit: 'preview' }, target.constructor);
    proxyHttpMethods(target, [{ name: 'edit' }]); connectSSE(target); Source.latest.onopen?.();
    return {
        target, requests, source: Source.latest,
        complete(index: number, count: number, cursor: number | string) {
            requests[index].resolve(new Response(JSON.stringify({ count, _cossack_return: count }), {
                headers: { 'Content-Type': 'application/json', 'X-Cossack-Request-Id': requests[index].id, 'X-Cossack-SSE-Cursor': String(cursor) },
            }));
        },
        fail(index: number) {
            requests[index].resolve(new Response(JSON.stringify({ code: 'COSSACK_VALIDATION_FAILED', error: 'Invalid' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }));
        },
    };
}

describe('SSE optimistic snapshot ordering', () => {
    it('confirms its own broadcast without repeating its increment or settling loading', async () => {
        const f = fixture(); const call = f.target.edit();
        f.source.state(1, 1, f.requests[0].id);
        expect(f.target.count).toBe(1); expect(f.target.loading.edit).toBe(1);
        f.complete(0, 1, 1); await call;
        expect(f.target.count).toBe(1); expect(f.target.loading).toEqual({});
        expect(f.target).not.toHaveProperty('_cossack_request_id');
        expect(f.target).not.toHaveProperty('_cossack_sse_cursor');
    });

    it('ignores the matching duplicate broadcast when its reply arrived first', async () => {
        const f = fixture(); const call = f.target.edit(); f.complete(0, 1, 1); await call;
        f.source.state(1, 1, f.requests[0].id);
        expect(f.target.count).toBe(1); expect(f.target.loading).toEqual({});
    });

    it('retains a newer snapshot before and after a held older response settles', async () => {
        const f = fixture(); const call = f.target.edit();
        f.source.state(1, 1, f.requests[0].id); f.source.state(6, 2);
        expect(f.target.count).toBe(6);
        f.complete(0, 1, 1); expect(await call).toBe(1);
        expect(f.target.count).toBe(6); expect(f.target.loading).toEqual({});
        f.source.state(7, 3); f.source.state(1, 1, f.requests[0].id);
        expect(f.target.count).toBe(7);
    });

    it('removes only a stale confirmed contribution when polling coalesces publications', async () => {
        const f = fixture(); const old = f.target.edit(), next = f.target.edit();
        f.source.state(1, 2);
        f.complete(0, 1, 1); await old;
        expect(f.target.count).toBe(2); expect(f.target.loading.edit).toBe(1);
        f.fail(1); await expect(next).rejects.toBeDefined();
        expect(f.target.count).toBe(1); expect(f.target.loading).toEqual({});
    });

    it('does not confirm another component consumer from a foreign request ID', async () => {
        const f = fixture(); const call = f.target.edit();
        f.source.state(5, 1, 'other-consumer');
        expect(f.target.count).toBe(6); expect(f.target.loading.edit).toBe(1);
        f.fail(0); await expect(call).rejects.toBeDefined(); expect(f.target.count).toBe(5);
    });

    it('preserves a pending local edit but accepts later authoritative revisions after cleanup', async () => {
        const f = fixture(); const call = f.target.edit(); f.target.setProperty('count', 99);
        f.source.state(1, 1, f.requests[0].id); f.complete(0, 1, 1); await call;
        expect(f.target.count).toBe(99);
        f.source.state(1, 1, f.requests[0].id); expect(f.target.count).toBe(99);
        f.source.state(1, 2); expect(f.target.count).toBe(1); expect(f.target.draft).toBe('draft');
    });

    it('restores server authority on a reopened source with a lower process-local cursor', async () => {
        const f = fixture(); f.source.state(8, 8); f.target.count = 99;
        f.source.onopen?.(); f.source.state(3, 0);
        expect(f.target.count).toBe(3); expect(f.target.draft).toBe('draft');
    });

    it.each(['-1', 'NaN', '1.5', '9007199254740992'])('rejects invalid response cursor %s before state hydration', async cursor => {
        const f = fixture(); const call = f.target.edit(); f.complete(0, 100, cursor);
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_RESPONSE_INVALID', requestId: f.requests[0].id });
        expect(f.target.count).toBe(0); expect(f.target.loading).toEqual({});
    });

    it.each([-1, 'invalid'])('retains the first confirmed stream state when its final cursor is %s', async cursor => {
        const f = fixture(); const call = f.target.edit(); const id = f.requests[0].id;
        f.requests[0].resolve(new Response([
            { v: 1, type: 'yield', requestId: id, state: { count: 5, _cossack_sse_cursor: 1 }, value: 'first' },
            { v: 1, type: 'done', requestId: id, state: { count: 100, _cossack_sse_cursor: cursor }, value: 'last' },
        ].map(frame => JSON.stringify(frame) + '\n').join(''), {
            headers: { 'Content-Type': RPC_STREAM_CONTENT_TYPE, 'X-Cossack-Request-Id': id },
        }));
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_RESPONSE_INVALID', requestId: id });
        expect(f.target.count).toBe(5); expect(f.target.loading).toEqual({});
    });

    describe('publications that arrive before their stream reply frames', () => {
        function plainFixture() {
            const requests: Array<{ id: string; resolve: (response: Response) => void }> = [];
            vi.stubGlobal('EventSource', Source);
            vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>(resolve => {
                requests.push({ id: new Headers(init.headers).get('X-Cossack-Request-Id')!, resolve });
            })));
            class Plain {}
            const target: any = { constructor: Plain, count: 0, loading: {},
                _optimisticLockedKeys: {}, _optimisticPendingState: {}, __cossack_proxies: new Map(), requestUpdate: vi.fn(),
                getInitialStateFromWindow: () => ({ componentRouteId: 'plain', scopeKey: 'one', transport: 'sse' }),
                getPublicState() { return { count: this.count }; },
                getMethod: () => undefined, hasMethod: () => false,
                setProperty(key: string, value: unknown) { this[key] = value; noteOptimisticWrite(this, key); },
                _isOptimisticLocked: () => false,
            };
            Reflect.defineMetadata('cossack:state', { count: {} }, Plain);
            proxyHttpMethods(target, [{ name: 'stream' }]); connectSSE(target); Source.latest.onopen?.();
            const stream = (index: number, frames: Array<[type: 'yield' | 'done', count: number, cursor: number]>) => {
                const id = requests[index].id;
                const encoder = new TextEncoder();
                let controller!: ReadableStreamDefaultController<Uint8Array>;
                requests[index].resolve(new Response(new ReadableStream<Uint8Array>({ start: c => { controller = c; } }), {
                    headers: { 'Content-Type': RPC_STREAM_CONTENT_TYPE, 'X-Cossack-Request-Id': id },
                }));
                return {
                    send(at: number) {
                        const [type, count, cursor] = frames[at];
                        controller.enqueue(encoder.encode(JSON.stringify({ v: 1, type, requestId: id,
                            state: { count, _cossack_sse_cursor: cursor }, value: count }) + '\n'));
                        if (type === 'done') controller.close();
                    },
                };
            };
            return { target, requests, source: Source.latest, stream };
        }
        const drain = async (call: any) => { const values = []; for await (const value of call) values.push(value); return values; };
        const tick = () => new Promise(resolve => setTimeout(resolve, 0));

        it('keeps the final state when every publication precedes the reply', async () => {
            const f = plainFixture(); const call = f.target.stream(); const id = f.requests[0].id;
            f.source.state(1, 1, id); f.source.state(2, 2, id);
            expect(f.target.count).toBe(2);
            const reply = f.stream(0, [['yield', 1, 1], ['done', 2, 2]]);
            const values = drain(call); reply.send(0); reply.send(1);
            expect(await values).toEqual([1]);
            expect(f.target.count).toBe(2); expect(f.target.loading).toEqual({});
        });

        it('keeps the final state when its own publication precedes the yield frame (browser order)', async () => {
            // Observed in workerd dev: SSE c1 -> yield c1 (deduped) -> done c2 -> SSE c2 (deduped).
            const f = plainFixture(); const call = f.target.stream(); const id = f.requests[0].id;
            const reply = f.stream(0, [['yield', 1, 1], ['done', 2, 2]]);
            const values = drain(call);
            f.source.state(1, 1, id); await tick();
            expect(f.target.count).toBe(1);
            reply.send(0); await tick();
            reply.send(1); await values;
            f.source.state(2, 2, id);
            expect(f.target.count).toBe(2); expect(f.target.loading).toEqual({});
        });

        it('keeps the final frame after an own publication even when no frame repeats it', async () => {
            const f = plainFixture(); const call = f.target.stream(); const id = f.requests[0].id;
            const reply = f.stream(0, [['done', 2, 2]]);
            const values = drain(call);
            f.source.state(1, 1, id); await tick();
            reply.send(0); await values;
            expect(f.target.count).toBe(2);
        });

        it('still preserves a local edit made after its own publication', async () => {
            const f = plainFixture(); const call = f.target.stream(); const id = f.requests[0].id;
            const reply = f.stream(0, [['yield', 1, 1], ['done', 2, 2]]);
            const values = drain(call);
            f.source.state(1, 1, id); await tick();
            f.target.setProperty('count', 50);
            reply.send(0); await tick(); reply.send(1); await values;
            expect(f.target.count).toBe(50);
        });
    });
});