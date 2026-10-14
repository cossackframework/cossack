// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRpcHttpError, readRpcJsonResponse, RPC_JSON_RESPONSE_MAX_BYTES } from '../src/shared/rpc-json';
import { proxyHttpMethods } from '../src/shared/method-proxy';
import { RPC_NATIVE_RESPONSE_HEADER } from '../src/shared/rpc-stream';

const requestId = 'known-json-call';
const headers = { 'X-Cossack-Request-Id': requestId, 'Content-Type': 'application/json' };
const encoder = new TextEncoder();

function wire(bytes: Uint8Array, status = 200) {
    return new Response(new ReadableStream({ start(controller) {
        // A byte at a time exercises UTF-8 boundaries without browser decoding.
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
    } }), { status, headers });
}

describe('ordinary RPC envelope boundaries', () => {
    it('decodes split Unicode and preserves ordinary app state named requestId', async () => {
        const data = { title: 'สวัสดี 🌻', requestId: 42, _cossack_return: { saved: true } };
        await expect(readRpcJsonResponse(wire(encoder.encode(JSON.stringify(data))), 'component')).resolves.toEqual(data);
    });

    it.each(['null', '[]', '42', '"text"', '{broken', ''])('rejects malformed object envelope %j with correlation', async text => {
        await expect(readRpcJsonResponse(new Response(text, { headers }), 'component')).rejects.toMatchObject({
            code: 'COSSACK_RPC_RESPONSE_INVALID', requestId,
        });
    });

    it.each([200, 400])('rejects invalid UTF-8 in a %s JSON body', async status => {
        const bytes = new Uint8Array([...encoder.encode('{"error":"'), 0xc3, 0x28, ...encoder.encode('"}')]);
        const response = wire(bytes, status);
        await expect(status === 200 ? readRpcJsonResponse(response, 'component') : readRpcHttpError(response))
            .rejects.toMatchObject({ code: 'COSSACK_RPC_RESPONSE_INVALID', requestId });
    });

    it('accepts the exact byte limit, including multibyte JSON text', async () => {
        const data = { title: '🌻', padding: '' };
        data.padding = 'x'.repeat(RPC_JSON_RESPONSE_MAX_BYTES - encoder.encode(JSON.stringify(data)).byteLength);
        await expect(readRpcJsonResponse(Response.json(data, { headers }), 'component')).resolves.toEqual(data);
    });

    it.each([200, 400])('bounds the entire %s body and cancels its producer on overflow', async status => {
        const cancel = vi.fn();
        const response = new Response(new ReadableStream({ start(controller) {
            controller.enqueue(encoder.encode(JSON.stringify({ padding: 'x'.repeat(RPC_JSON_RESPONSE_MAX_BYTES) })));
        }, cancel }), { status, headers });
        await expect(status === 200 ? readRpcJsonResponse(response, 'component') : readRpcHttpError(response))
            .rejects.toMatchObject({ code: 'COSSACK_RPC_RESPONSE_TOO_LARGE', requestId });
        expect(cancel).toHaveBeenCalledOnce();
        expect(response.body?.locked).toBe(false);
    });

    it.each(['/detail?query=🌻', '../detail', '?tab=1', '#result', 'https://example.test/detail', '//example.test/detail'])
        ('accepts redirect %s without rewriting its document-relative URL', async location => {
            await expect(readRpcJsonResponse(Response.json({ _cossack_redirect: location }, { headers }), 'component'))
                .resolves.toEqual({ _cossack_redirect: location });
        });

    it('requires a service object and accepts an explicit empty state', async () => {
        await expect(readRpcJsonResponse(Response.json({ _cossack_service_state: {} }, { headers }), 'service'))
            .resolves.toEqual({ _cossack_service_state: {} });
    });

    it('preserves nested field errors and learns a body ID when no header is supplied', async () => {
        const fieldErrors = { input: { children: { title: ['Required'] } } };
        await expect(readRpcHttpError(Response.json({ code: 'COSSACK_VALIDATION_FAILED', error: 'Check input',
            requestId, fieldErrors }, { status: 422 }))).resolves.toMatchObject({
            code: 'COSSACK_VALIDATION_FAILED', message: 'Check input', status: 422, requestId, fieldErrors,
        });
    });

    it.each(['application/json', 'application/problem+json'])('rejects malformed declared %s diagnostics', async mime => {
        await expect(readRpcHttpError(new Response('upstream failure', {
            status: 502, headers: { ...headers, 'Content-Type': mime },
        }))).rejects.toMatchObject({ code: 'COSSACK_RPC_RESPONSE_INVALID', status: 502, requestId });
    });

    it.each(['upstream private body', ''])('keeps non-JSON middleware failures opaque: %j', async text => {
        await expect(readRpcHttpError(new Response(text, {
            status: 503, headers: { ...headers, 'Content-Type': 'text/plain' },
        }))).resolves.toMatchObject({ code: 'COSSACK_RPC_FAILED', message: 'HTTP error! status: 503', status: 503, requestId });
    });

    it('keeps native failure JSON opaque even when it resembles protocol diagnostics', async () => {
        await expect(readRpcHttpError(Response.json({ code: 'FAKE', error: 'PRIVATE', requestId: 'foreign', fieldErrors: [] }, {
            status: 400, headers: { ...headers, [RPC_NATIVE_RESPONSE_HEADER]: 'native' },
        }))).resolves.toMatchObject({ code: 'COSSACK_RPC_FAILED', message: 'HTTP error! status: 400', status: 400, requestId });
    });

    it('sanitizes a failed body read, retains the ID and releases ownership', async () => {
        const response = new Response(new ReadableStream({ start(controller) {
            controller.error(new Error('PRIVATE upstream detail'));
        } }), { headers });
        await expect(readRpcJsonResponse(response, 'component')).rejects.toMatchObject({
            code: 'COSSACK_RPC_NETWORK_FAILED', requestId,
            message: 'RPC response failed. The server outcome is unknown and is never retried.',
        });
        expect(response.body?.locked).toBe(false);
    });
});

describe('ordinary JSON lifetime through the public component proxy', () => {
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    function setup(status = 200, timeout?: number) {
        let body!: ReadableStreamDefaultController<Uint8Array>;
        const cancel = vi.fn();
        const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { body = controller; }, cancel }),
            { status, headers });
        const fetchMock = vi.fn().mockResolvedValue(response);
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const component: any = {
            constructor: class Client {}, __cossack_componentRouteId: 'page', __cossack_proxies: new Map(),
            loading: {},
            count: 0,
            getInitialStateFromWindow: () => ({ componentRouteId: 'page', transport: 'http' }),
            getPublicState: () => ({ count: component.count }),
            setProperty: vi.fn((key: string, value: unknown) => { component[key] = value; }),
            requestUpdate: vi.fn(), hasMethod: () => false,
        };
        if (timeout !== undefined) Reflect.defineMetadata('cossack:server-methods', { save: { timeout } }, component.constructor);
        proxyHttpMethods(component, [{ name: 'save' }]);
        const call = component.__cossack_proxies.get('save')();
        const result = Promise.resolve(call);
        // Observe rejection immediately; deadline/cancel can settle before assertions.
        void result.catch(() => {});
        return { body, cancel, response, fetchMock, component, call, result };
    }

    it('waits for EOF before hydration and completion, without redispatching', async () => {
        const fixture = setup();
        fixture.body.enqueue(encoder.encode('{"count":9,"_cossack_return":"saved"}'));
        await vi.waitFor(() => expect(fixture.response.body?.locked).toBe(true));
        expect(fixture.component.loading.save).toBe(1);
        expect(fixture.component.setProperty).not.toHaveBeenCalledWith('count', 9);
        fixture.body.close();
        await expect(fixture.result).resolves.toBe('saved');
        expect(fixture.component.setProperty).toHaveBeenCalledWith('count', 9);
        expect(fixture.component.loading).toEqual({});
        expect(fixture.fetchMock).toHaveBeenCalledOnce();
        expect(fixture.response.body?.locked).toBe(false);
    });

    it.each([200, 400])('cancels a parked %s body with its known ID and no hydration', async status => {
        const fixture = setup(status);
        await vi.waitFor(() => expect(fixture.response.body?.locked).toBe(true));
        fixture.call.cancel();
        await expect(fixture.result).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED', requestId });
        expect(fixture.cancel).toHaveBeenCalledOnce();
        expect(fixture.component.loading).toEqual({});
        expect(fixture.fetchMock).toHaveBeenCalledOnce();
        expect(fixture.response.body?.locked).toBe(false);
    });

    it.each([200, 400])('keeps the deadline active throughout a parked %s body', async status => {
        vi.useFakeTimers();
        const fixture = setup(status, 20);
        await vi.advanceTimersByTimeAsync(19);
        expect(fixture.component.loading.save).toBe(1);
        expect(fixture.response.body?.locked).toBe(true);
        await vi.advanceTimersByTimeAsync(1);
        await expect(fixture.result).rejects.toMatchObject({ code: 'COSSACK_RPC_TIMEOUT', requestId });
        expect(fixture.cancel).toHaveBeenCalledOnce();
        expect(fixture.component.loading).toEqual({});
        expect(fixture.fetchMock).toHaveBeenCalledOnce();
        expect(fixture.response.body?.locked).toBe(false);
    });
});
