import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack, CossackService, getRequestContext, Inject, Page, readRpcStream, RPC_NATIVE_RESPONSE_HEADER, RPC_STREAM_CONTENT_TYPE, Server, Service, State } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { computeRouteIds } from '../src/route-ids';

// An in-memory stand-in for snapshot/publication tests: one scope
// per collision-safe tuple name, first-initialization-wins snapshots, an
// append-only event log, and execute() serialization that publishes stream
// frames and passes materialized responses through. Cancellation is deliberately
// a no-op here; native workerd and generated deployment fixtures test that contract.
type FakeEvent = { cursor: number; event: string; data: string };
type FakeSnapshot = { state: string; cursor: number };

class FakeSseScope {
    snapshot: FakeSnapshot | null = null;
    events: FakeEvent[] = [];
    executed = 0;
    #tail: Promise<void> = Promise.resolve();

    async cancel(_operationId: string) {}

    async initialize(state: string) {
        if (!this.snapshot) {
            this.snapshot = { state, cursor: 0 };
            return { ...this.snapshot, fresh: true as const };
        }
        return { ...this.snapshot, fresh: false as const };
    }

    async currentState(): Promise<FakeSnapshot | null> {
        return this.snapshot ? { ...this.snapshot } : null;
    }

    async updates(after: number) {
        const snapshot = this.snapshot!;
        const resync = after > snapshot.cursor;
        return {
            snapshot: { ...snapshot },
            resync,
            events: resync ? [] : this.events.filter(event => event.cursor > after),
        };
    }

    async publish(state: string) { return this.#append('state-update', state, true); }
    async broadcast(event: string, data: string) { return this.#append(event, data, false); }

    async execute(action: (state: string) => Promise<Response>): Promise<Response> {
        const before = this.#tail;
        let release!: () => void;
        this.#tail = new Promise<void>(resolve => { release = resolve; });
        await before;
        this.executed++;
        let finished = false;
        const finish = () => { if (!finished) { finished = true; release(); } };
        const response = await action(this.snapshot!.state);
        if (!response.ok || response.headers.get(RPC_NATIVE_RESPONSE_HEADER) === 'native' ||
            response.headers.get('Content-Type')?.split(';', 1)[0] !== RPC_STREAM_CONTENT_TYPE) {
            finish();
            return response;
        }
        const scope = this;
        const iterator = readRpcStream(response)[Symbol.asyncIterator]();
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
                try {
                    const next = await iterator.next();
                    if (next.done) { finish(); controller.close(); return; }
                    const frame = next.value;
                    if (frame.type !== 'error') await scope.publish(JSON.stringify(frame.scopeState ?? frame.state));
                    controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
                    if (frame.type !== 'yield') { await iterator.return(undefined); finish(); controller.close(); }
                } catch (error) {
                    try { await iterator.return(undefined); }
                    finally { finish(); controller.error(error); }
                }
            },
            async cancel() { try { await iterator.return(undefined); } finally { finish(); } },
        }, { highWaterMark: 0 });
        return new Response(body, { status: response.status, headers: response.headers });
    }

    async #append(event: string, data: string, replacesState: boolean) {
        const cursor = this.events.length + 1;
        this.events.push({ cursor, event, data });
        this.snapshot = {
            state: replacesState ? data : this.snapshot!.state,
            cursor,
        };
        return { ...this.snapshot };
    }
}

function createFakeCoordinator() {
    const scopes = new Map<string, FakeSseScope>();
    return {
        scopes,
        getByName(name: string) {
            let scope = scopes.get(name);
            if (!scope) { scope = new FakeSseScope(); scopes.set(name, scope); }
            return scope;
        },
    };
}

const { registry, state, middlewares } = vi.hoisted(() => ({
    registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} as Record<string, any> },
    state: { coordinator: undefined as ReturnType<typeof createFakeCoordinator> | undefined },
    middlewares: [] as import('hono').MiddlewareHandler[],
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: middlewares }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

const path = '/src/pages/live/index.ts';
const layoutPath = '/src/pages/layout.ts';

@Service()
class Shared extends CossackService {
    @State() serviceCount = 0;
}

let childTarget: string;
class Child extends Cossack {
    @State() childCount = 0;
    @Server() async childIncrement() { return ++this.childCount; }
    @Server() async *childStream() { yield ++this.childCount; return ++this.childCount; }
    render() { childTarget = this._id; return html`child ${this.childCount}`; }
}

@Page({ services: [Shared] })
class Layout extends Cossack {
    render() { return html`${this.children}`; }
}

@Page({ transport: 'sse' })
class LivePage extends Cossack {
    @State() count = 0;
    @Inject(Shared) shared!: Shared;
    render() { return html`live ${this.count}${component(Child, {})}`; }
    @Server()
    async increment() {
        this.count++;
        this.shared.serviceCount++;
        return this.count;
    }
    @Server()
    async *stream() {
        this.count++;
        yield { step: this.count };
        this.count++;
        return 'finished';
    }
    @Server()
    async redirectToHome() {
        this.count++;
        getRequestContext()?.header('Location', '/after-increment');
        return 'redirected';
    }
    @Server()
    async announce() {
        this.broadcastEvent('counter:changed', this.count);
        return 'sent';
    }
}

registry.pages[path] = { default: LivePage };
registry.layouts[layoutPath] = { default: Layout };
const { createApp } = await import('../src/router');
const id = computeRouteIds([path], [layoutPath]).routePathToIdMap.get(path)!;

function env() {
    // One coordinator per test so SSR, /crpc, and /sse share one scope set.
    state.coordinator ??= createFakeCoordinator();
    return { COSSACK_SSE: state.coordinator, APP_URL: 'https://live.test' };
}

function scope(): FakeSseScope {
    return state.coordinator!.scopes.values().next().value as FakeSseScope;
}

const call = (action: string, extra: Record<string, unknown> = {}) =>
    createApp().request('/crpc', {
        method: 'POST',
        headers: { origin: 'http://localhost', 'Content-Type': 'application/json' },
        body: JSON.stringify({ componentRouteId: id, action, payload: [], scopeKey: 'user:anonymous', ...extra }),
    }, env() as any);

const page = () => createApp().request('/live', { headers: {} }, env() as any);

function readHydration(html: string) {
    return JSON.parse(html.match(/window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s)![1]);
}

async function collect(response: Response) {
    const frames = [];
    for await (const frame of readRpcStream(response)) frames.push(frame);
    return frames;
}

function parseSse(chunk: string) {
    return chunk.split('\n\n').filter(Boolean).map(block => {
        const event = { event: '', id: undefined as number | undefined, data: '' };
        for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) event.event = line.slice(7);
            if (line.startsWith('id: ')) event.id = Number(line.slice(4));
            if (line.startsWith('data: ')) event.data = line.slice(6);
        }
        return event;
    });
}

/** Accumulate chunks until the parsed events satisfy the predicate. */
async function readSseUntil(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    predicate: (events: Array<{ event: string; id?: number; data: string }>) => boolean,
    timeout = 3000,
) {
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        const next = await Promise.race([
            reader.read(),
            new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), remaining)),
        ]);
        if (next?.value) text += decoder.decode(next.value, { stream: true });
        const events = parseSse(text).filter(event => event.event);
        if (events.length && predicate(events)) return events;
    }
    throw new Error(`Timed out waiting for SSE data; received so far: ${JSON.stringify(text)}`);
}

afterEach(() => {
    state.coordinator = undefined;
    middlewares.length = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('SSE coordinator transport (/crpc and SSR through the distributed backend)', () => {
    it('initializes the scope on first SSR and hydrates authoritative state afterwards', async () => {
        const first = await page();
        expect(first.status).toBe(200);
        expect(JSON.parse(scope().snapshot!.state)).toMatchObject({ count: 0 });
        expect(scope().snapshot!.cursor).toBe(0);
        expect(readHydration(await first.text()).public).toEqual({ count: 0 });

        expect(await (await call('increment')).json()).toMatchObject({ _cossack_return: 1 });
        expect(JSON.parse(scope().snapshot!.state)).toMatchObject({ count: 1 });
        expect(scope().snapshot!.cursor).toBeGreaterThanOrEqual(1);
        const cursorAfterIncrement = scope().snapshot!.cursor;

        // A second SSR renders the shared state; it never resets the scope.
        const second = await page();
        expect(second.status).toBe(200);
        expect(readHydration(await second.text()).public).toMatchObject({ count: 1 });
        expect(JSON.parse(scope().snapshot!.state)).toMatchObject({ count: 1 });
        expect(scope().snapshot!.cursor).toBe(cursorAfterIncrement);
    });

    it('hydrates actions from the authoritative snapshot, not the browser state', async () => {
        await page();
        expect(await (await call('increment')).json()).toMatchObject({ _cossack_return: 1 });
        // A stale tab claims count = 0; the coordinator's count = 1 must win.
        const stale = await call('increment', { state: { count: 0 } });
        expect(await stale.json()).toMatchObject({ _cossack_return: 2 });
        expect(JSON.parse(scope().snapshot!.state)).toMatchObject({ count: 2 });
    });

    it.each(['childIncrement', 'childStream'])('keeps page state authoritative during child action %s', async action => {
        await page();
        const target = childTarget;
        expect(target).toBeTruthy();
        await call('increment');
        const response = await call(action, { target, state: { childCount: 0 } });
        expect(response.status).toBe(200);
        if (action === 'childStream') {
            const frames = await collect(response);
            expect(frames.at(-1)).toMatchObject({ state: { childCount: 2 }, scopeState: { count: 1 } });
        } else expect(await response.json()).toMatchObject({ childCount: 1, _cossack_return: 1 });
        expect(JSON.parse(scope().snapshot!.state)).toEqual({ count: 1 });
        expect(readHydration(await (await page()).text()).public.count).toBe(1);
    });

    it('returns redirects as JSON while still publishing the mutated state', async () => {
        await page();
        const redirected = await call('redirectToHome');
        expect(await redirected.json()).toEqual({ _cossack_redirect: '/after-increment' });
        expect(JSON.parse(scope().snapshot!.state)).toMatchObject({ count: 1 });
    });

    it('streams generators through the coordinator and publishes each frame', async () => {
        await page();
        const frames = await collect(await call('stream'));
        expect(frames).toMatchObject([
            { type: 'yield', value: { step: 1 }, state: { count: 1 } },
            { type: 'done', value: 'finished', state: { count: 2 } },
        ]);
        const stateUpdates = scope().events.filter(event => event.event === 'state-update');
        expect(JSON.parse(stateUpdates.at(-1)!.data)).toMatchObject({ count: 2 });
        expect(JSON.parse(scope().snapshot!.state)).toMatchObject({ count: 2 });
        expect(scope().snapshot!.cursor).toBeGreaterThanOrEqual(2);
    });

    it('serializes scope actions through execute()', async () => {
        await page();
        const [a, b] = await Promise.all([call('increment'), call('increment')]);
        expect(await a.json()).toMatchObject({ _cossack_return: 1 });
        expect(await b.json()).toMatchObject({ _cossack_return: 2 });
        expect(scope().executed).toBe(2);
    });

    it('forwards component broadcasts as coordinator events', async () => {
        await page();
        expect(await (await call('announce')).json()).toMatchObject({ _cossack_return: 'sent' });
        const broadcast = scope().events.find(event => event.event === 'event');
        expect(broadcast).toBeDefined();
        expect(JSON.parse(broadcast!.data)).toEqual({ eventName: 'counter:changed', payload: [0] });
    });
});

describe('SSE coordinator subscription endpoint', () => {
    it('denies the first replay frame when authorization changes after response headers', async () => {
        await page(); await call('increment'); await call('announce');
        let allowed = true;
        middlewares.push(async (c, next) => { if (!allowed) return c.json({ denied: true }, 403); await next(); });
        const response = await createApp().request(`/sse/${id}?scopeKey=user:anonymous`, { headers: { 'Last-Event-ID': '0' } }, env() as any);
        expect(response.status).toBe(200); allowed = false;
        const reader = response.body!.getReader(); const first = new TextDecoder().decode((await reader.read()).value);
        expect(first).toBe('event: authorization-error\ndata: {"code":"COSSACK_REALTIME_AUTH_CHANGED"}\n\n');
        expect((await reader.read()).done).toBe(true);
    });

    it('rechecks between replay frames rather than trusting the initial decision', async () => {
        await page(); await call('increment'); await call('increment');
        let allowed = true; let checks = 0;
        middlewares.push(async (c, next) => { checks++; if (!allowed) return c.json({ denied: true }, 403); await next(); });
        const response = await createApp().request(`/sse/${id}?scopeKey=user:anonymous`, { headers: { 'Last-Event-ID': '0' } }, env() as any);
        const reader = response.body!.getReader();
        expect(new TextDecoder().decode((await reader.read()).value)).toContain('"count":1');
        allowed = false;
        const terminal = new TextDecoder().decode((await reader.read()).value);
        expect(terminal).toContain('event: authorization-error'); expect(terminal).not.toContain('"count":2');
        expect(checks).toBe(3); expect((await reader.read()).done).toBe(true);
    });

    it('revalidates an idle stream before its heartbeat and awaits scope cleanup', async () => {
        await page(); vi.useFakeTimers();
        let allowed = true; let cleaned = 0;
        middlewares.push(async (c, next) => {
            if (!allowed) return c.json({ denied: true }, 403);
            try { await next(); } finally { cleaned++; }
        });
        const response = await createApp().request(`/sse/${id}?scopeKey=user:anonymous`, {}, env() as any);
        const reader = response.body!.getReader();
        await reader.read(); await reader.read(); const before = cleaned;
        const pending = reader.read(); await vi.advanceTimersByTimeAsync(14800);
        expect(cleaned).toBe(before); allowed = false; await vi.advanceTimersByTimeAsync(200);
        expect(new TextDecoder().decode((await pending).value)).toContain('COSSACK_REALTIME_AUTH_CHANGED');
        expect((await reader.read()).done).toBe(true);
    });

    it('cold starts with layout services even before SSR', async () => {
        const response = await createApp().request(`/sse/${id}?scopeKey=user:anonymous`, {}, env() as any);
        expect(response.status).toBe(200);
        const reader = response.body!.getReader();
        const initial = await readSseUntil(reader, events => events.some(event => event.event === 'connected'));
        expect(JSON.parse(initial[0].data)).toEqual({ count: 0 });
        await reader.cancel();
    });

    it('polls only with reader demand and stops after response cancellation', async () => {
        await page();
        const updates = vi.spyOn(scope(), 'updates');
        const response = await createApp().request(`/sse/${id}?scopeKey=user:anonymous`, {}, env() as any);
        const setupCalls = updates.mock.calls.length;
        await new Promise(resolve => setTimeout(resolve, 450));
        expect(updates).toHaveBeenCalledTimes(setupCalls);
        await response.body!.cancel();
        await new Promise(resolve => setTimeout(resolve, 450));
        expect(updates).toHaveBeenCalledTimes(setupCalls);
    });

    it('replays missed events before acknowledging the latest snapshot cursor', async () => {
        await page();
        await call('increment');
        await call('announce');
        await call('increment');
        const response = await createApp().request(`/sse/${id}?scopeKey=user:anonymous`, {
            headers: { 'Last-Event-ID': '0' },
        }, env() as any);
        const reader = response.body!.getReader();
        const events = await readSseUntil(reader, events => events.some(event => event.event === 'connected'));
        const ids = events.flatMap(event => event.id === undefined ? [] : [event.id]);
        expect(ids).toEqual([...ids].sort((a, b) => a - b));
        expect(events.some(event => event.event === 'event')).toBe(true);
        expect(JSON.parse(events.findLast(event => event.event === 'state-update')!.data)).toEqual({ count: 2 });
        await reader.cancel();
    });
    it('streams the snapshot, then incremental events with cursors', async () => {
        await page();
        const response = await createApp().request(`/sse/${id}?scopeKey=user:anonymous`, {}, env() as any);
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('text/event-stream');
        const reader = response.body!.getReader();
        const initial = await readSseUntil(reader, events => events.length >= 2);
        expect(initial.map(event => event.event)).toEqual(['state-update', 'connected']);
        expect(JSON.parse(initial[0].data)).toEqual({ count: 0 });

        expect(await (await call('increment')).json()).toMatchObject({ _cossack_return: 1 });
        const update = await readSseUntil(reader, events => events.some(event =>
            event.event === 'state-update' && JSON.parse(event.data).count === 1));
        const delivered = update.find(event => event.event === 'state-update' && JSON.parse(event.data).count === 1)!;
        expect(delivered.id).toBeGreaterThanOrEqual(1);
        await reader.cancel();
    });

    it('resumes from Last-Event-ID without replaying delivered events', async () => {
        await page();
        await call('increment');
        const first = await createApp().request(`/sse/${id}?scopeKey=user:anonymous`, {
            headers: { 'Last-Event-ID': String(scope().snapshot!.cursor) },
        }, env() as any);
        const reader = first.body!.getReader();
        const initial = await readSseUntil(reader, events => events.length >= 2);
        // The snapshot supersedes every already-delivered event; no further
        // events arrive.
        expect(initial.map(event => event.event)).toEqual(['state-update', 'connected']);
        expect(JSON.parse(initial[0].data)).toMatchObject({ count: 1 });
        expect(initial[0].id).toBe(scope().snapshot!.cursor);
        const silence = Promise.race([
            reader.read().then(() => 'unexpected'),
            new Promise(resolve => setTimeout(() => resolve('silence'), 450)),
        ]);
        expect(await silence).toBe('silence');
        await reader.cancel();
    });

    it('rejects invalid cursors', async () => {
        await page();
        const response = await createApp().request(`/sse/${id}?scopeKey=user:anonymous&cursor=nope`, {}, env() as any);
        expect(response.status).toBe(400);
    });

    it('still rejects cross-user scope keys under the coordinator', async () => {
        await page();
        const response = await createApp().request(`/sse/${id}?scopeKey=user:someone-else`, {}, env() as any);
        expect(response.status).toBe(403);
    });
});

describe('Cloudflare without the coordinator binding', () => {
    it('diagnoses /crpc and /sse instead of falling back to process-local state', async () => {
        vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
        const rpc = await createApp().request('/crpc', {
            method: 'POST',
            headers: { origin: 'http://localhost', 'Content-Type': 'application/json' },
            body: JSON.stringify({ componentRouteId: id, action: 'increment', payload: [], scopeKey: 'user:anonymous' }),
        }, { APP_URL: 'https://live.test' } as any);
        expect(rpc.status).toBe(500);
        expect(await rpc.json()).toMatchObject({ code: 'COSSACK_SSE_BINDING_MISSING' });

        const subscribe = await createApp().request(`/sse/${id}?scopeKey=user:anonymous`, {}, { APP_URL: 'https://live.test' } as any);
        expect(subscribe.status).toBe(500);
        expect(await subscribe.json()).toMatchObject({ code: 'COSSACK_SSE_BINDING_MISSING' });

        const rendered = await createApp().request('/live', {}, { APP_URL: 'https://live.test' } as any);
        expect(rendered.status).toBe(500);
    });
});
