import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientState, Optimistic, Server, Service, State } from '../src/shared/decorators';
import { CossackService } from '../src/shared/cossack-service';
import { ServiceScope } from '../src/shared/service-scope';
import { proxyHttpMethods } from '../src/shared/method-proxy';
import { optimistic } from '../src/shared/optimistic';
import { noteOptimisticWrite } from '../src/shared/optimistic-state';
import { RPC_STREAM_CONTENT_TYPE } from '../src/shared/rpc-stream';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

function fixture(kind: 'http' | 'sse' | 'service', timeout?: number) {
    @Service() class Counter extends CossackService {
        @State() count = 0;
        @ClientState() previewCount = 0;
        @ClientState() draft = 'original';
        @Server() run() { return 'native'; }
        @Optimistic('run') preview() {
            optimistic<Counter>(this).increment('count', 1);
            optimistic<Counter>(this).increment('previewCount', 1);
        }
    }
    Reflect.defineMetadata('cossack:server-methods', { run: timeout ? { timeout } : {} }, Counter);
    let resolve!: (response: Response) => void;
    let init!: RequestInit;
    const fetchMock = vi.fn((_url: string, options: RequestInit) => {
        init = options;
        // This producer deliberately ignores abort. Cancellation must release
        // framework ownership without waiting for application/network I/O.
        return new Promise<Response>(settle => { resolve = settle; });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first: any = { loading: {}, requestUpdate: vi.fn() };
    const late: any = { loading: {}, requestUpdate: vi.fn() };
    let scope: ServiceScope | undefined;
    let target: any;
    if (kind === 'service') {
        scope = new ServiceScope(undefined, [Counter], { ownerRouteId: 'layout' });
        scope.subscribe(Counter, first);
        target = scope.resolve(Counter);
    } else {
        target = { constructor: Counter, count: 0, previewCount: 0, draft: 'original', loading: first.loading,
            __cossack_proxies: new Map(), _optimisticLockedKeys: {}, _optimisticPendingState: {},
            requestUpdate: first.requestUpdate, getPublicState() { return { count: this.count }; },
            getInitialStateFromWindow: () => ({ componentRouteId: 'counter', transport: kind, scopeKey: 'one' }),
            getMethod: () => () => {
                optimistic(target).increment('count', 1); optimistic(target).increment('previewCount', 1);
            },
            setProperty(key: string, value: unknown) { this[key] = value; noteOptimisticWrite(this, key); },
            _isOptimisticLocked: () => false,
        };
        proxyHttpMethods(target, [{ name: 'run' }]);
    }
    let producer!: ReadableStreamDefaultController<Uint8Array>;
    const canceled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { producer = controller; }, cancel: canceled });
    const encoder = new TextEncoder();
    return {
        target, first, late, fetchMock, body, canceled,
        get id() { return new Headers(init.headers).get('X-Cossack-Request-Id')!; },
        get signal() { return init.signal!; },
        attachLate() { scope?.subscribe(Counter, late); },
        reply() { resolve(new Response(body, { headers: { 'Content-Type': RPC_STREAM_CONTENT_TYPE,
            'X-Cossack-Request-Id': new Headers(init.headers).get('X-Cossack-Request-Id')! } })); },
        line(value: unknown) { producer.enqueue(encoder.encode(typeof value === 'string' ? value : JSON.stringify(value) + '\n')); },
        frame(type: string, count = 5) { return { v: 1, type, requestId: this.id, value: count, state: { count } }; },
        close() { producer.close(); },
        dispose() { return scope?.disposeAsync(); },
    };
}

describe.each(['http', 'sse', 'service'] as const)('%s optimistic stream ownership', kind => {
    it.each(['visible-error', 'malformed-json', 'wrong-request', 'truncated', 'after-terminal'] as const)(
        'retains confirmed yields and settles every consumer once after %s', async failure => {
            const f = fixture(kind); const call = f.target.run(); const iterator = call[Symbol.asyncIterator]();
            expect(f.target.count).toBe(1); expect(f.target.previewCount).toBe(1);
            const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
            expect(request.state).toEqual({ count: 0 });
            f.reply(); f.line(f.frame('yield'));
            expect(await iterator.next()).toEqual({ value: 5, done: false });
            expect(f.target.count).toBe(5); expect(f.first.loading).toEqual({ run: 1 });
            f.attachLate(); if (kind === 'service') expect(f.late.loading).toEqual({ run: 1 });
            f.target.draft = 'keep this draft';
            let code = failure === 'truncated' ? 'COSSACK_RPC_STREAM_TRUNCATED' : 'COSSACK_RPC_STREAM_INVALID';
            if (failure === 'visible-error') {
                code = 'COSSACK_RPC_CLIENT_ERROR';
                f.line({ v: 1, type: 'error', requestId: f.id, code, message: 'Committed before failure' });
            } else if (failure === 'malformed-json') f.line('{bad-json}\n');
            else if (failure === 'wrong-request') f.line({ ...f.frame('done', 999), requestId: 'another-call' });
            else if (failure === 'after-terminal') { f.line(f.frame('done', 999)); f.line(f.frame('yield', 1000)); }
            f.close();
            await expect(iterator.next()).rejects.toMatchObject({ code, requestId: f.id });
            await expect(call).rejects.toMatchObject({ code, requestId: f.id });
            await expect(call).rejects.toMatchObject({ code, requestId: f.id });
            expect(f.target.count).toBe(5); expect(f.target.previewCount).toBe(0);
            expect(f.target.draft).toBe('keep this draft');
            expect(f.first.loading).toEqual({}); expect(f.late.loading).toEqual({});
            expect(f.fetchMock).toHaveBeenCalledOnce(); expect(f.canceled).not.toHaveBeenCalled();
            expect(f.body.locked).toBe(false); await f.dispose();
        });

    it('cancels after a confirmed yield without dropping its state or waiting for another frame', async () => {
        const f = fixture(kind); const call = f.target.run(); const iterator = call[Symbol.asyncIterator]();
        f.reply(); f.line(f.frame('yield')); await iterator.next(); f.attachLate();
        f.target.draft = 'keep this draft';
        const pending = iterator.next();
        await call.cancel(); await call.cancel();
        await expect(pending).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED', requestId: f.id });
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED', requestId: f.id });
        expect(f.target.count).toBe(5); expect(f.target.previewCount).toBe(0);
        expect(f.target.draft).toBe('keep this draft');
        expect(f.first.loading).toEqual({}); expect(f.late.loading).toEqual({});
        expect(f.canceled).toHaveBeenCalledOnce(); expect(f.signal.aborted).toBe(true);
        expect(f.body.locked).toBe(false); expect(f.fetchMock).toHaveBeenCalledOnce(); await f.dispose();
    });

    it('releases ownership before headers even when the request producer ignores abort', async () => {
        const f = fixture(kind); const call = f.target.run(); f.attachLate();
        await call.cancel();
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED', requestId: f.id });
        expect(f.target.count).toBe(0); expect(f.target.previewCount).toBe(0);
        expect(f.first.loading).toEqual({}); expect(f.late.loading).toEqual({});
        // A late completion cannot hydrate or release a different invocation.
        f.line(f.frame('done', 999)); f.reply();
        await vi.waitFor(() => expect(f.canceled).toHaveBeenCalledOnce());
        expect(f.target.count).toBe(0); expect(f.first.loading).toEqual({});
        expect(f.body.locked).toBe(false); expect(f.fetchMock).toHaveBeenCalledOnce(); await f.dispose();
    });

    it('cancels a started request before headers without waiting for ignored abort', async () => {
        const f = fixture(kind); const call = f.target.run(); const iterator = call[Symbol.asyncIterator]();
        const pending = iterator.next(); const outcome = pending.catch((error: unknown) => error);
        await Promise.resolve(); f.attachLate();
        await call.cancel();
        expect(await outcome).toMatchObject({ code: 'COSSACK_RPC_CANCELLED', requestId: f.id });
        expect(f.target.count).toBe(0); expect(f.target.previewCount).toBe(0);
        expect(f.first.loading).toEqual({}); expect(f.late.loading).toEqual({});
        f.line(f.frame('done', 999)); f.reply();
        await vi.waitFor(() => expect(f.canceled).toHaveBeenCalledOnce());
        expect(f.target.count).toBe(0); expect(f.fetchMock).toHaveBeenCalledOnce(); await f.dispose();
    });

    it('times out before headers and releases a late response without hydration', async () => {
        vi.useFakeTimers();
        const f = fixture(kind, 50); const call = f.target.run(); const iterator = call[Symbol.asyncIterator]();
        const pending = iterator.next(); const outcome = pending.catch((error: unknown) => error);
        await Promise.resolve(); f.attachLate();
        await vi.advanceTimersByTimeAsync(50);
        expect(await outcome).toMatchObject({ code: 'COSSACK_RPC_TIMEOUT', requestId: f.id });
        expect(f.target.count).toBe(0); expect(f.target.previewCount).toBe(0);
        expect(f.first.loading).toEqual({}); expect(f.late.loading).toEqual({});
        f.line(f.frame('done', 999)); f.reply(); await vi.advanceTimersByTimeAsync(0);
        expect(f.canceled).toHaveBeenCalledOnce(); expect(f.target.count).toBe(0);
        expect(f.fetchMock).toHaveBeenCalledOnce(); await f.dispose();
    });

    it('times out a held next frame without restoring already confirmed public state', async () => {
        vi.useFakeTimers();
        const f = fixture(kind, 50); const call = f.target.run(); const iterator = call[Symbol.asyncIterator]();
        f.reply(); f.line(f.frame('yield')); await iterator.next(); f.attachLate();
        const pending = iterator.next(); const outcome = pending.catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(50);
        expect(await outcome).toMatchObject({ code: 'COSSACK_RPC_TIMEOUT', requestId: f.id });
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_TIMEOUT', requestId: f.id });
        expect(f.target.count).toBe(5); expect(f.target.previewCount).toBe(0);
        expect(f.first.loading).toEqual({}); expect(f.late.loading).toEqual({});
        expect(f.canceled).toHaveBeenCalledOnce(); expect(f.body.locked).toBe(false);
        expect(f.fetchMock).toHaveBeenCalledOnce(); await f.dispose();
    });
});

describe('overlapping explicit-service streams', () => {
    @Service() class Editor {
        @State() count = 0;
        @State() title = 'original';
        @Server() changeCount() { return 'native'; }
        @Server() changeTitle(_title: string) { return 'native'; }
        @Optimistic('changeCount') countPreview() { optimistic<Editor>(this).increment('count', 1); }
        @Optimistic('changeTitle') titlePreview(title: string) { this.title = title; }
    }
    it.each([false, true])('retains independent fields and a confirmed yield when the title stream fails (local edit %s)', async localEdit => {
        const sources: Array<{ id: string; controller: ReadableStreamDefaultController<Uint8Array>; body: ReadableStream<Uint8Array> }> = [];
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const fetchMock = vi.fn((_url: string, init: RequestInit) => {
            let controller!: ReadableStreamDefaultController<Uint8Array>;
            const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
            const id = new Headers(init.headers).get('X-Cossack-Request-Id')!;
            sources.push({ id, controller, body });
            return Promise.resolve(new Response(body, { headers: { 'Content-Type': RPC_STREAM_CONTENT_TYPE, 'X-Cossack-Request-Id': id } }));
        });
        vi.stubGlobal('fetch', fetchMock);
        const scope = new ServiceScope(undefined, [Editor], { ownerRouteId: 'layout' });
        const consumer = { loading: {}, requestUpdate: vi.fn() };
        scope.subscribe(Editor, consumer);
        const editor = scope.resolve(Editor);
        const count = editor.changeCount() as any, title = editor.changeTitle('preview') as any;
        const countIterator = count[Symbol.asyncIterator](), titleIterator = title[Symbol.asyncIterator]();
        expect(editor.count).toBe(1); expect(editor.title).toBe('preview');
        expect(consumer.loading).toEqual({ changeCount: 1, changeTitle: 1 });
        const send = (index: number, frame: object) => sources[index].controller.enqueue(new TextEncoder().encode(
            JSON.stringify({ v: 1, requestId: sources[index].id, ...frame }) + '\n'));
        send(0, { type: 'yield', value: 5, state: { count: 5, title: 'original' } });
        await countIterator.next();
        expect(editor.count).toBe(5); expect(editor.title).toBe('preview');
        if (localEdit) editor.title = 'local edit';
        send(1, { type: 'error', code: 'COSSACK_VALIDATION_FAILED', message: 'Rejected' }); sources[1].controller.close();
        await expect(titleIterator.next()).rejects.toMatchObject({ code: 'COSSACK_VALIDATION_FAILED' });
        expect(editor.count).toBe(5); expect(editor.title).toBe(localEdit ? 'local edit' : 'original');
        expect(consumer.loading).toEqual({ changeCount: 1 });
        await count.cancel();
        await expect(count).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
        expect(editor.count).toBe(5); expect(editor.title).toBe(localEdit ? 'local edit' : 'original');
        expect(consumer.loading).toEqual({}); expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sources.every(source => !source.body.locked)).toBe(true); await scope.disposeAsync();
    });
});
