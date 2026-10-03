import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyHttpMethods, proxyServerMethods, applyStateToComponent } from '../src/shared/method-proxy';
import { routeSocketFrame, failPendingSocketCalls } from '../src/shared/transport-connections';
import { ServiceScope } from '../src/shared/service-scope';
import { Cossack } from '../src/shared/cossack';
import { Service, State, Store, ClientState, Optimistic, Server } from '../src/shared/decorators';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture(transport: 'http' | 'sse' | 'ws', timeout?: number) {
    const pending: Array<{ resolve: (response: Response) => void; reject: (error: unknown) => void; body: any }> = [];
    const sent: any[] = [];
    const ws = { readyState: 1, send: (text: string) => sent.push(JSON.parse(text)) };
    vi.stubGlobal('WebSocket', Object.assign(class {}, { OPEN: 1 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise<Response>((resolve, reject) => {
        pending.push({ resolve, reject, body: JSON.parse(String(init.body)) });
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })));
    const target: any = {
        constructor: class Counter {}, count: 0, title: 'original', cart: { rows: [1] }, local: 'original',
        loading: {}, _optimisticLockedKeys: {}, _optimisticPendingState: {}, __cossack_proxies: new Map(),
        websockets: new Map([['page', ws]]), consume: () => undefined,
        getInitialStateFromWindow: () => ({ componentRouteId: 'counter', scopeKey: 'one', transport }),
        getPublicState() { return { count: this.count, title: this.title, cart: this.cart }; },
        hasMethod: (name: string) => name === 'optimisticEdit',
        getMethod: () => (patch: any) => {
            if (patch.nested) target.cart.rows.push(patch.nested);
            else Object.assign(target, patch);
        },
        _isOptimisticLocked(key: string) { return Object.keys(this.loading).some(name => this._optimisticLockedKeys[name]?.has(key)); },
        setProperty(key: string, value: unknown) { this[key] = value; }, requestUpdate: vi.fn(),
    };
    Reflect.defineMetadata('cossack:state', { count: {}, title: {} }, target.constructor);
    Reflect.defineMetadata('cossack:store', { cart: {} }, target.constructor);
    Reflect.defineMetadata('cossack:client-state', new Set(['local']), target.constructor);
    Reflect.defineMetadata('cossack:optimistic-handlers', { edit: 'optimisticEdit', other: 'optimisticEdit' }, target.constructor);
    if (timeout) Reflect.defineMetadata('cossack:server-methods', { edit: { timeout } }, target.constructor);
    if (transport === 'ws') proxyServerMethods(target, ['edit', 'other'].map(name => ({ name, channel: 'global', provider: 'page' })));
    else proxyHttpMethods(target, [{ name: 'edit' }, { name: 'other' }]);
    return {
        target, pending, sent, ws,
        complete(index: number, state: any = {}) {
            if (transport === 'ws') routeSocketFrame(ws, { v: 1, type: 'done', requestId: sent[index].requestId, value: 'ok', state });
            else pending[index].resolve(new Response(JSON.stringify({ ...state, _cossack_return: 'ok' }), { headers: { 'Content-Type': 'application/json' } }));
        },
        fail(index: number) {
            if (transport === 'ws') routeSocketFrame(ws, { v: 1, type: 'error', requestId: sent[index].requestId, code: 'COSSACK_RPC_VALIDATION_FAILED', message: 'Invalid', fieldErrors: { count: ['Invalid'] } });
            else pending[index].resolve(new Response(JSON.stringify({ code: 'COSSACK_RPC_VALIDATION_FAILED', error: 'Invalid', fieldErrors: { count: ['Invalid'] } }), { status: 422, headers: { 'Content-Type': 'application/json' } }));
        },
    };
}

describe.each(['http', 'sse', 'ws'] as const)('%s optimistic call ownership', transport => {
    it('rolls back a rejected edit and settles its loading indicator', async () => {
        const f = fixture(transport); const call = f.target.edit({ count: 1 });
        expect(f.target.count).toBe(1); f.fail(0);
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_VALIDATION_FAILED' });
        expect(f.target.count).toBe(0); expect(f.target.loading).toEqual({});
    });
    it('retains a newer successful edit when an older same-method call fails last', async () => {
        const f = fixture(transport); const old = f.target.edit({ count: 1 }); const next = f.target.edit({ count: 2 });
        f.complete(1, { count: 20 }); await next;
        expect(f.target.loading.edit).toBe(1);
        f.fail(0); await expect(old).rejects.toMatchObject({ code: 'COSSACK_RPC_VALIDATION_FAILED' });
        expect(f.target.count).toBe(20); expect(f.target.loading).toEqual({});
    });
    it('removes both failed contributions in either completion order', async () => {
        for (const order of [[0, 1], [1, 0]]) {
            const f = fixture(transport); const calls = [f.target.edit({ count: 1 }), f.target.edit({ count: 2 })];
            f.fail(order[0]); await expect(calls[order[0]]).rejects.toBeDefined();
            f.fail(order[1]); await expect(calls[order[1]]).rejects.toBeDefined();
            expect(f.target.count).toBe(0); expect(f.target.loading).toEqual({});
        }
    });
    it('rolls back independent fields without erasing another pending edit', async () => {
        const f = fixture(transport); const count = f.target.edit({ count: 1 }); const title = f.target.other({ title: 'next' });
        f.fail(0); await expect(count).rejects.toBeDefined();
        expect(f.target.count).toBe(0); expect(f.target.title).toBe('next');
        f.complete(1, { title: 'saved' }); await title;
        expect(f.target.title).toBe('saved');
    });
    it('does not treat an unrelated response echo as confirmation of another pending field', async () => {
        const f = fixture(transport); const count = f.target.edit({ count: 1 });
        const title = f.target.other({ title: 'next' });
        f.complete(1, { count: 0, title: 'saved', cart: { rows: [1] } }); await title;
        expect(f.target.count).toBe(1); expect(f.target.title).toBe('saved');
        f.fail(0); await expect(count).rejects.toBeDefined();
        expect(f.target.count).toBe(0); expect(f.target.title).toBe('saved'); expect(f.target.loading).toEqual({});
    });
    it('captures nested stores and local fields for rollback without sharing local state', async () => {
        const f = fixture(transport); const call = f.target.edit({ nested: 2 });
        expect(f.target.cart.rows).toEqual([1, 2]); f.fail(0); await expect(call).rejects.toBeDefined();
        expect(f.target.cart.rows).toEqual([1]);
        const local = f.target.edit({ local: 'draft' });
        if (transport !== 'ws') expect(f.pending[1].body.state).not.toHaveProperty('local');
        f.fail(1); await expect(local).rejects.toBeDefined(); expect(f.target.local).toBe('original');
    });
    it('accepts authoritative snapshots after a failed call without replaying it', async () => {
        const f = fixture(transport); const call = f.target.edit({ count: 1 });
        f.fail(0); await expect(call).rejects.toBeDefined();
        applyStateToComponent(f.target, { count: 7 });
        expect(f.target.count).toBe(7);
        expect(transport === 'ws' ? f.sent.length : f.pending.length).toBe(1);
    });
    it('retains the newer authoritative result when successful replies arrive out of order', async () => {
        const f = fixture(transport); const old = f.target.edit({ count: 1 }); const next = f.target.edit({ count: 2 });
        f.complete(1, { count: 20 }); await next;
        f.complete(0, { count: 10 }); await old;
        expect(f.target.count).toBe(20); expect(f.target.loading).toEqual({});
    });
    it('preserves a later user replacement after success or failure', async () => {
        for (const success of [true, false]) {
            const f = fixture(transport); const call = f.target.edit({ count: 1 }); f.target.count = 99;
            if (success) { f.complete(0, { count: 2 }); await call; }
            else { f.fail(0); await expect(call).rejects.toBeDefined(); }
            expect(f.target.count).toBe(99); expect(f.target.loading).toEqual({});
        }
    });
    it('preserves a later user nested write when a store edit fails', async () => {
        const f = fixture(transport); const call = f.target.edit({ nested: 2 });
        f.target.cart.rows.push(3); f.fail(0); await expect(call).rejects.toBeDefined();
        expect(f.target.cart.rows).toEqual([1, 2, 3]);
    });
    it('does not let an intervening broadcast erase a later local edit', async () => {
        const f = fixture(transport); const call = f.target.edit({ count: 1 });
        f.target.count = 99; applyStateToComponent(f.target, { count: 5 });
        expect(f.target.count).toBe(99);
        f.complete(0, { count: 6 }); await call; expect(f.target.count).toBe(99);
        applyStateToComponent(f.target, { count: 7 }); expect(f.target.count).toBe(7);
    });
    it('keeps uncertainty on disconnect and converges from a subsequent snapshot without retry', async () => {
        const f = fixture(transport); const call = f.target.edit({ count: 1 });
        if (transport === 'ws') failPendingSocketCalls(f.ws);
        else f.pending[0].reject(new TypeError('Connection lost'));
        await expect(call).rejects.toMatchObject({ code: transport === 'ws' ? 'COSSACK_RPC_TRANSPORT_CLOSED' : 'COSSACK_RPC_NETWORK_FAILED' });
        expect(f.target.loading).toEqual({});
        applyStateToComponent(f.target, { count: 7 });
        expect(f.target.count).toBe(7);
        expect(transport === 'ws' ? f.sent.length : f.pending.length).toBe(1);
    });
    it('settles a timed-out optimistic call once and does not dispatch it again', async () => {
        const f = fixture(transport, 15); const call = f.target.edit({ count: 1 });
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_TIMEOUT' });
        expect(f.target.count).toBe(0); expect(f.target.loading).toEqual({});
        await call.cancel(); expect(f.target.loading).toEqual({});
        applyStateToComponent(f.target, { count: 5 }); expect(f.target.count).toBe(5);
        expect(transport === 'ws' ? f.sent.filter(frame => frame.type === 'action').length : f.pending.length).toBe(1);
    });
});

it.each(['http', 'sse'] as const)('sends confirmed %s state before an optimistic increment', async transport => {
    const f = fixture(transport); const call = f.target.edit({ count: 1 });
    expect(f.pending[0].body.state.count).toBe(0);
    f.complete(0, { count: 1 }); await call;
    expect(f.target.count).toBe(1);
});

describe('explicit scoped service optimistic calls', () => {
    @Service()
    class Counter {
        @State() count = 0;
        @Store() cart = { rows: [1] };
        @Server() edit(_value: number) { return 'server'; }
        @Optimistic('edit') preview(value: number) { this.count = value; this.cart.rows.push(value); }
    }
    it('uses per-call rollback and preserves newer successful state for every subscriber', async () => {
        const pending: Array<(response: Response) => void> = [];
        const bodies: any[] = [];
        vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => {
            bodies.push(JSON.parse(String(init.body)));
            return new Promise<Response>(resolve => pending.push(resolve));
        }));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const scope = new ServiceScope(undefined, [Counter], { ownerRouteId: 'layout' });
        const first = { loading: {}, requestUpdate: vi.fn() }, second = { loading: {}, requestUpdate: vi.fn() };
        const off = [scope.subscribe(Counter, first), scope.subscribe(Counter, second)];
        const service = scope.resolve(Counter);
        const old = service.edit(1), next = service.edit(2);
        expect(service.count).toBe(2); expect(bodies.map(body => body.state.count)).toEqual([0, 0]);
        pending[1](new Response(JSON.stringify({ _cossack_return: 'ok', _cossack_service_state: { count: 20, cart: { rows: [1, 20] } } }), { headers: { 'Content-Type': 'application/json' } }));
        await next; expect(first.loading).toEqual({ edit: 1 }); expect(second.loading).toEqual({ edit: 1 });
        pending[0](new Response(JSON.stringify({ code: 'COSSACK_RPC_VALIDATION_FAILED', error: 'Invalid' }), { status: 422, headers: { 'Content-Type': 'application/json' } }));
        await expect(old).rejects.toBeDefined();
        expect(service.count).toBe(20); expect(service.cart.rows).toEqual([1, 20]);
        expect(first.loading).toEqual({}); expect(second.loading).toEqual({});
        off.forEach(disconnect => disconnect()); await scope.dispose();
    });
});

it('observes real component nested edits after optimistic capture and preserves them on rejection', async () => {
    class Editor extends Cossack {
        @Store() cart = { rows: [1] };
        @Optimistic('edit') preview() { this.cart.rows.push(2); }
        @Server() edit() { return 'server'; }
    }
    let reply!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { reply = resolve; })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const editor = new Editor();
    (editor as any).getInitialStateFromWindow = () => ({ componentRouteId: 'editor', transport: 'http' });
    vi.spyOn(editor, 'requestUpdate').mockResolvedValue(true);
    editor.connectedCallback();
    proxyHttpMethods(editor, [{ name: 'edit' }]);
    const call = editor.edit();
    expect(editor.cart.rows).toEqual([1, 2]);
    editor.cart.rows.push(3);
    reply(new Response(JSON.stringify({ code: 'COSSACK_RPC_VALIDATION_FAILED', error: 'Invalid' }), { status: 422, headers: { 'Content-Type': 'application/json' } }));
    await expect(call).rejects.toBeDefined();
    expect(editor.cart.rows).toEqual([1, 2, 3]); expect(editor.loading).toEqual({});
    await editor.destroy();
});

it('retains inherited optimistic siblings and restores partial writes from a throwing handler', async () => {
    class Parent { count = 0; inheritedPreview() { this.count = 3; } }
    class Child extends Parent { preview() { this.count = 4; throw undefined; } }
    const f = fixture('http');
    Reflect.defineMetadata('cossack:optimistic-handlers', { other: 'inheritedPreview' }, Parent);
    Reflect.defineMetadata('cossack:optimistic-handlers', { edit: 'preview' }, Child);
    Reflect.defineMetadata('cossack:state', { count: {} }, Parent);
    Object.setPrototypeOf(f.target, Child.prototype); f.target.constructor = Child;
    f.target.getMethod = (key: string) => (f.target as any)[key].bind(f.target);
    proxyHttpMethods(f.target, [{ name: 'edit' }, { name: 'other' }]);
    const inherited = f.target.other(); expect(f.target.count).toBe(3);
    const failed = f.target.edit(); expect(f.target.count).toBe(3);
    f.fail(1); await expect(failed).rejects.toBeDefined();
    f.fail(0); await expect(inherited).rejects.toBeDefined(); expect(f.target.count).toBe(0);
});

it('rejects asynchronous optimistic handlers and restores synchronous promise-producing edits', async () => {
    for (const declared of [true, false]) {
        const f = fixture('http');
        f.target.getMethod = () => declared ? async () => { f.target.count = 9; }
            : () => { f.target.count = 9; return Promise.reject(new Error('Ignored preview promise')); };
        proxyHttpMethods(f.target, [{ name: 'edit' }]);
        const call = f.target.edit();
        expect(f.target.count).toBe(0); expect(f.pending[0].body.state.count).toBe(0);
        f.complete(0, { count: 5 }); await call; expect(f.target.count).toBe(5);
    }
});

it('restores an uncopyable over-depth preview without losing the actual call lifecycle', async () => {
    const f = fixture('http');
    const tree: any = {}; let cursor = tree;
    for (let index = 0; index < 260; index++) cursor = cursor.next = {};
    f.target.getMethod = () => () => { f.target.cart = tree; };
    const call = f.target.edit();
    expect(f.target.cart).toEqual({ rows: [1] });
    expect(f.pending).toHaveLength(1);
    f.fail(0); await expect(call).rejects.toBeDefined(); expect(f.target.loading).toEqual({});
});

it('retains null local replacements when another call snapshots public state', async () => {
    const f = fixture('http'); const first = f.target.edit({ count: 1 });
    f.target.count = null;
    const second = f.target.other({ title: 'next' });
    expect(f.pending[1].body.state.count).toBeNull();
    f.fail(0); await expect(first).rejects.toBeDefined();
    f.fail(1); await expect(second).rejects.toBeDefined(); expect(f.target.count).toBeNull();
});

it('does not turn a later client-only deep value into a throwing setter or a loading leak', async () => {
    class Editor extends Cossack {
        @State() count = 0;
        @ClientState() draft: unknown = 0;
        @Optimistic('edit') preview() { this.count = 1; this.draft = 1; }
        @Server() edit() { return 'server'; }
    }
    const tree: any = {}; let cursor = tree;
    for (let index = 0; index < 260; index++) cursor = cursor.next = {};
    let reply!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { reply = resolve; })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const editor = new Editor();
    (editor as any).getInitialStateFromWindow = () => ({ componentRouteId: 'editor', transport: 'http' });
    vi.spyOn(editor, 'requestUpdate').mockResolvedValue(true);
    editor.connectedCallback(); proxyHttpMethods(editor, [{ name: 'edit' }]);
    const call = editor.edit();
    expect(() => { editor.draft = tree; }).not.toThrow();
    reply(new Response(JSON.stringify({ code: 'COSSACK_RPC_VALIDATION_FAILED', error: 'Invalid' }), { status: 422, headers: { 'Content-Type': 'application/json' } }));
    await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_VALIDATION_FAILED' });
    expect(editor.count).toBe(0); expect((editor.draft as any).next).toBeTruthy();
    expect(editor.loading).toEqual({}); await editor.destroy();
});
