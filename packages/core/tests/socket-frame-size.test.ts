// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyHttpMethods, proxyServerMethods } from '../src/shared/method-proxy';
import { connectWebSocket, disconnectWebSocket, routeSocketFrame } from '../src/shared/transport-connections';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** A component with one realtime server method bound to `socket`. */
function realtimeHost(socket: { readyState: number; send: (data: string) => void }) {
    const host: any = { loading: {}, requestUpdate: vi.fn(), constructor: class Page {}, __cossack_proxies: new Map(),
        getInitialStateFromWindow: () => ({ componentRouteId: 'page', transport: 'http' }),
        count: 0, getPublicState: () => ({ count: host.count }), hasMethod: () => false,
        setProperty(key: string, value: unknown) { this[key] = value; } };
    Reflect.defineMetadata('cossack:server-methods', { run: {} }, host.constructor);
    proxyHttpMethods(host, [{ name: 'run' }]);
    host.websocket = socket; host.consume = () => undefined;
    proxyServerMethods(host, [{ name: 'run', channel: 'channel' }]);
    return host;
}

function startCall(host: any, socket: { send: { mock: { calls: unknown[][] } } }) {
    const call = host.run();
    const requestId = JSON.parse(socket.send.mock.calls.at(-1)![0] as string).requestId as string;
    return { call, iterator: call[Symbol.asyncIterator]() as AsyncIterator<unknown>, requestId };
}

const frameStringifies = (spy: { mock: { calls: unknown[][] } }, frames: unknown[]) =>
    spy.mock.calls.filter(([value]) => frames.includes(value)).length;

describe('incoming WebSocket frame size', () => {
    it('measures a received frame from its text without re-serializing it, even when queued', async () => {
        class FakeWebSocket { static OPEN = 1; readyState = 1; sent: string[] = []; send(data: string) { this.sent.push(data); } close() {} }
        vi.stubGlobal('WebSocket', FakeWebSocket);
        const component: any = realtimeHost({ readyState: 1, send: () => {} });
        Object.assign(component, { _phase: 'Mounted', websocket: undefined,
            getInitialStateFromWindow: () => ({ realtimeTarget: 'scope', routePath: '/', componentRouteId: 'page', transport: 'http' }) });
        connectWebSocket(component);
        const socket = component.websocket as FakeWebSocket & { onmessage: (event: { data: string }) => void };
        try {
            const call = component.run();
            const iterator = call[Symbol.asyncIterator]();
            const requestId = JSON.parse(socket.sent[0]).requestId;
            const stringify = vi.spyOn(JSON, 'stringify');
            const parse = vi.spyOn(JSON, 'parse');
            for (let index = 0; index < 3; index++) {
                socket.onmessage({ data: JSON.stringify({ v: 1, type: index === 2 ? 'done' : 'yield', requestId, value: index, state: { count: index } }) });
            }
            const frames = parse.mock.results.map(result => result.value);
            expect(frames).toHaveLength(3);
            // The consumer has not pulled yet: every frame was queued, sized from its text.
            expect(frameStringifies(stringify, frames)).toBe(0);
            stringify.mockRestore();
            expect(await iterator.next()).toEqual({ done: false, value: 0 });
            expect(await iterator.next()).toEqual({ done: false, value: 1 });
            expect(await iterator.next()).toEqual({ done: true, value: 2 });
            expect(component.count).toBe(2);
        } finally { disconnectWebSocket(component); }
    });

    it('serializes a parsed-only frame once to route and queue it', async () => {
        const socket = { readyState: 1, send: vi.fn() };
        const host = realtimeHost(socket);
        const { call, iterator, requestId } = startCall(host, socket);
        const frames = [0, 1, 2].map(index => ({ v: 1, type: index === 2 ? 'done' : 'yield', requestId, value: index, state: { count: index } }));
        const stringify = vi.spyOn(JSON, 'stringify');
        for (const frame of frames) routeSocketFrame(socket, frame);
        expect(frameStringifies(stringify, frames)).toBe(frames.length);
        stringify.mockRestore();
        expect(await iterator.next()).toEqual({ done: false, value: 0 });
        expect(await iterator.next()).toEqual({ done: false, value: 1 });
        expect(await iterator.next()).toEqual({ done: true, value: 2 });
        await expect(call).resolves.toBe(2);
        expect(host.count).toBe(2);
    });

    it('still rejects a frame whose received text exceeds 1 MiB', async () => {
        const socket = { readyState: 1, send: vi.fn() };
        const host = realtimeHost(socket);
        const { call, requestId } = startCall(host, socket);
        const frame = { v: 1, type: 'done', requestId, value: 'é'.repeat(600_000), state: {} };
        // 600 000 characters but 1.2 MB of UTF-8: the byte size decides.
        expect(routeSocketFrame(socket, frame, JSON.stringify(frame))).toBe(true);
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_STREAM_TOO_LARGE', requestId });
    });

    it('still bounds the queued bytes with the measured sizes', async () => {
        const socket = { readyState: 1, send: vi.fn() };
        const host = realtimeHost(socket);
        const { call, iterator, requestId } = startCall(host, socket);
        const chunk = 'x'.repeat(900_000);
        for (let index = 0; index < 5; index++) {
            const frame = { v: 1, type: 'yield', requestId, value: chunk, state: { count: index } };
            routeSocketFrame(socket, frame, JSON.stringify(frame));
        }
        // Four ~900 kB frames fit the 4 MiB buffer; the fifth exceeds it.
        void call.catch(() => {});
        await expect(iterator.next()).rejects.toMatchObject({ code: 'COSSACK_RPC_BUFFER_EXCEEDED', requestId });
    });
});
