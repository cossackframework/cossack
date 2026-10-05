// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ClientVisibleError, input } from '@cossackframework/core';
import { defineApi, type ApiSchemas } from '../src/api';

afterEach(() => vi.restoreAllMocks());
function app(handler: (c: import('hono').Context) => Promise<Response>) { const app = new Hono(); app.all('/items/:id', handler); return app; }
function request(body: unknown, query = '', options: RequestInit = {}) {
    return new Request('http://localhost/items/a' + query, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...options });
}
async function failure(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    const data: any = await response.json();
    expect(data).toMatchObject({ code, requestId: expect.any(String) });
    expect(response.headers.get('X-Cossack-Request-Id')).toBe(data.requestId);
    return data;
}

describe('declared native API contracts', () => {
    it('parses each location before authorization and mutation, then validates and serializes output', async () => {
        const trace: string[] = [];
        const endpoint = defineApi({
            input: { params: input.object({ id: input.string() }),
                query: input.object({ page: input.number({ coerce: true }), tags: input.array(input.string()) }),
                body: input.object({ amount: input.number({ coerce: true }) }) },
            queryArrays: ['tags'], output: input.object({ total: input.number(), at: input.date({ coerce: true }) }),
            authorize: ({ input }) => { trace.push('authorize'); expect(input.body.amount).toBe(2); return true; },
            handler: ({ input, c, signal }) => {
                trace.push('handler'); expect(signal.aborted).toBe(false); expect(input.params.id).toBe('a');
                expect(input.query.tags).toEqual(['雪', 'b']); c.header('Set-Cookie', 'api=ok; HttpOnly');
                return { total: input.body.amount + input.query.page, at: new Date('2026-01-01') };
            },
        });
        const response = await app(endpoint).fetch(request({ amount: '2' }, '?page=3&tags=%E9%9B%AA&tags=b'));
        expect(response.status).toBe(200); expect(await response.json()).toEqual({ total: 5, at: '2026-01-01T00:00:00.000Z' });
        expect(trace).toEqual(['authorize', 'handler']); expect(response.headers.get('Set-Cookie')).toContain('api=ok');
    });

    it.each(['body', 'query', 'params'] as const)('invalid %s causes zero authorization calls and mutations', async location => {
        const authorize = vi.fn(() => true); const handler = vi.fn(() => new Response('done'));
        const schema = input.object({ count: input.number() });
        const schemas: ApiSchemas = { [location]: schema };
        const endpoint = defineApi({ input: schemas, authorize, handler });
        const data = await failure(await app(endpoint).fetch(request({ count: 'bad' }, '?count=bad')), 400, 'COSSACK_VALIDATION_FAILED');
        expect(data.fieldErrors[location]).toBeTruthy(); expect(authorize).not.toHaveBeenCalled(); expect(handler).not.toHaveBeenCalled();
    });

    it('rejects unknown nested body keys and repeated scalar queries', async () => {
        const handler = vi.fn(() => new Response());
        const endpoint = defineApi({ input: { body: input.object({ profile: input.object({ name: input.string() }) }),
            query: input.object({ tag: input.string() }) }, handler });
        const data = await failure(await app(endpoint).fetch(request({ profile: { name: 'x', admin: true } }, '?tag=x')), 400, 'COSSACK_VALIDATION_FAILED');
        expect(data.fieldErrors).toEqual({ body: { profile: { admin: 'Unknown field.' } } });
        await failure(await app(endpoint).fetch(request({ profile: { name: 'ok' } }, '?tag=x&tag=y')), 400, 'COSSACK_API_QUERY_REPEATED');
        expect(handler).not.toHaveBeenCalled();
    });

    it('keeps one explicitly declared query value as an array and leaves missing optional arrays absent', async () => {
        const endpoint = defineApi({ input: { query: input.object({ tags: input.array(input.string()).optional() }) }, queryArrays: ['tags'],
            output: input.object({ tags: input.array(input.string()).optional() }), handler: ({ input }) => input.query });
        expect(await (await app(endpoint).fetch(request(undefined, '?tags=one'))).json()).toEqual({ tags: ['one'] });
        expect(await (await app(endpoint).fetch(request(undefined))).json()).toEqual({});
    });

    it.each([['{broken', 'application/json', 400, 'COSSACK_API_JSON_INVALID'],
        ['{}', 'text/plain', 415, 'COSSACK_API_MEDIA_TYPE']] as const)('rejects malformed or incompatible body (%s)', async (body, type, status, code) => {
        const handler = vi.fn(() => new Response());
        const endpoint = defineApi({ input: { body: input.object({}) }, handler });
        await failure(await app(endpoint).fetch(request(undefined, '', { body, headers: { 'Content-Type': type } })), status, code);
        expect(handler).not.toHaveBeenCalled();
    });

    it('checks actual stream bytes without trusting a false Content-Length and releases the reader', async () => {
        const cancel = vi.fn(); const handler = vi.fn(() => new Response());
        const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"secret":"private-big-body"}')); }, cancel });
        const incoming = request(undefined, '', { body: stream, headers: { 'Content-Type': 'application/json', 'Content-Length': '2' }, duplex: 'half' } as RequestInit);
        const endpoint = defineApi({ input: { body: input.object({ secret: input.string() }) }, maxBodyBytes: 8, handler });
        const data = await failure(await app(endpoint).fetch(incoming), 413, 'COSSACK_API_INPUT_TOO_LARGE');
        expect(JSON.stringify(data)).not.toContain('private-big-body'); expect(handler).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
        expect(incoming.body!.locked).toBe(false);
    });

    it('rejects invalid UTF-8 and accepts a JSON vendor content type', async () => {
        const endpoint = defineApi({ input: { body: input.object({}) }, handler: () => new Response('ok') });
        await failure(await app(endpoint).fetch(request(undefined, '', { body: new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]) })), 400, 'COSSACK_API_JSON_INVALID');
        expect((await app(endpoint).fetch(request({}, '', { body: '{}', headers: { 'Content-Type': 'application/vnd.app+json; charset=utf-8' } }))).status).toBe(200);
    });

    it('parses a missing optional body and bounds query size and field count', async () => {
        const endpoint = defineApi({ input: { body: input.object({}).optional(), query: input.object({}, { unknownKeys: 'strip' }) }, handler: ({ input }) => {
            expect(input.body).toBeUndefined(); return new Response('ok');
        } });
        expect((await app(endpoint).fetch(request(undefined))).status).toBe(200);
        await failure(await app(endpoint).fetch(request(undefined, '?x=' + 'a'.repeat(65536))), 413, 'COSSACK_API_INPUT_TOO_LARGE');
        await failure(await app(endpoint).fetch(request(undefined, '?' + Array.from({ length: 1025 }, (_, i) => 'k' + i + '=v').join('&'))), 413, 'COSSACK_API_INPUT_TOO_LARGE');
    });

    it('denies authorization before mutation and maps authentication markers without their private message', async () => {
        const handler = vi.fn(() => new Response());
        const endpoint = defineApi({ authorize: () => false, handler });
        await failure(await app(endpoint).fetch(request(undefined)), 403, 'COSSACK_AUTH_FORBIDDEN');
        const authentication = defineApi({ authorize: () => { throw Object.assign(Error('private-auth-details'), { authorizationCode: 'COSSACK_AUTH_UNAUTHENTICATED' }); }, handler });
        const data = await failure(await app(authentication).fetch(request(undefined)), 401, 'COSSACK_AUTH_UNAUTHENTICATED');
        expect(JSON.stringify(data)).not.toContain('private-auth-details'); expect(handler).not.toHaveBeenCalled();
    });

    it.each(['input', 'authorize', 'handler', 'output'] as const)('keeps unexpected %s callback failures private', async stage => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        const crash = () => { throw Object.assign(Error('private-contract-key'), { config: { token: 'private-error-property' } }); };
        const handler = vi.fn(() => stage === 'handler' ? crash() : { value: 'ok' });
        const endpoint = defineApi({ input: { body: input.object({ value: input.string() }).refine(() => stage === 'input' ? crash() : true) },
            authorize: () => stage === 'authorize' ? crash() : true,
            output: input.object({ value: input.string() }).refine(() => stage === 'output' ? crash() : true), handler });
        const application = app(endpoint);
        const data = await failure(await application.fetch(new Request('http://localhost/items/private-path-key?token=private-query-key', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer private-header-key' }, body: JSON.stringify({ value: 'ok' }),
        })), 500, 'COSSACK_API_INTERNAL');
        expect(logged).toHaveBeenCalledOnce();
        expect(logged.mock.calls[0]).toHaveLength(1);
        expect(logged.mock.calls[0][0]).toMatchObject({ event: 'cossack.api.failure', requestId: data.requestId,
            route: '/items/:id', action: 'POST', runtime: 'unknown', stage, code: 'COSSACK_API_INTERNAL', durationMs: expect.any(Number) });
        expect(logged.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(0);
        const serialized = JSON.stringify([data, logged.mock.calls]);
        for (const sentinel of ['private-contract-key', 'private-error-property', 'private-path-key', 'private-query-key', 'private-header-key']) expect(serialized).not.toContain(sentinel);
        if (stage === 'input' || stage === 'authorize') expect(handler).not.toHaveBeenCalled();
    });

    it('treats an output schema failure as an internal server error', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const endpoint = defineApi({ output: input.object({ value: input.number() }), handler: () => ({ value: 'private-wrong-output' }) } as any);
        const data = await failure(await app(endpoint).fetch(request(undefined)), 500, 'COSSACK_API_INTERNAL');
        expect(data.fieldErrors).toBeUndefined(); expect(JSON.stringify(data)).not.toContain('private-wrong-output');
    });

    it('does not allow a native Response to bypass JSON output validation', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {}); const cancel = vi.fn();
        const endpoint = defineApi({ output: input.string(), handler: () => new Response(new ReadableStream({ cancel })) } as any);
        await failure(await app(endpoint).fetch(request(undefined)), 500, 'COSSACK_API_INTERNAL');
        expect(cancel).toHaveBeenCalledOnce();
    });

    it('preserves native redirects, cookies, custom status and streaming bodies', async () => {
        const redirect = defineApi({ handler: ({ c }) => { c.header('Set-Cookie', 'auth=ok; HttpOnly'); return c.redirect('/signed-in', 303); } });
        const response = await app(redirect).fetch(request(undefined));
        expect(response.status).toBe(303); expect(response.headers.get('Location')).toBe('/signed-in'); expect(response.headers.get('Set-Cookie')).toContain('auth=ok');
        expect(response.headers.getSetCookie()).toEqual(['auth=ok; HttpOnly']);
        const cookies = defineApi({ handler: ({ c }) => { c.header('Set-Cookie', 'context=one'); return new Response('ok', { headers: { 'Set-Cookie': 'native=two' } }); } });
        const chain = new Hono(); chain.use('*', async (_c, next) => { await next(); }); chain.all('/items/:id', cookies);
        expect((await chain.fetch(request(undefined))).headers.getSetCookie()).toEqual(['context=one', 'native=two']);
        const endpoint = defineApi({ timeoutMs: 5, handler: () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('one')); c.close(); } }), { status: 202 }) });
        const streamed = await app(endpoint).fetch(request(undefined)); expect(streamed.status).toBe(202); expect(await streamed.text()).toBe('one');
    });

    it('preserves controlled handler errors and correlates Hono HTTP responses', async () => {
        const visible = defineApi({ handler: () => { throw new ClientVisibleError('Choose another name.'); } });
        expect((await failure(await app(visible).fetch(request(undefined)), 400, 'COSSACK_API_REJECTED')).error).toBe('Choose another name.');
        const http = defineApi({ handler: () => { throw new HTTPException(409, { res: new Response('conflict', { status: 409, headers: { 'X-Control': 'yes' } }) }); } });
        const response = await app(http).fetch(request(undefined)); expect(response.status).toBe(409);
        expect(response.headers.get('X-Cossack-Request-Id')).toBeTruthy(); expect(response.headers.get('X-Control')).toBe('yes'); expect(await response.text()).toBe('conflict');
    });

    it.each(['input', 'authorize', 'handler', 'output'] as const)('releases an ignored %s callback at its deadline', async stage => {
        const wait = () => new Promise<never>(() => {}); const handler = vi.fn(() => stage === 'handler' ? wait() : { value: 'ok' });
        const endpoint = defineApi({ timeoutMs: 15, input: { body: input.object({ value: input.string() }).refine(() => stage === 'input' ? wait() : true) },
            authorize: () => stage === 'authorize' ? wait() : true,
            output: input.object({ value: input.string() }).refine(() => stage === 'output' ? wait() : true), handler });
        await failure(await app(endpoint).fetch(request({ value: 'ok' })), 504, 'COSSACK_API_TIMEOUT');
        if (stage === 'input' || stage === 'authorize') expect(handler).not.toHaveBeenCalled();
    });

    it('releases a stalled body reader even if source cancellation never completes', async () => {
        const cancel = vi.fn(() => new Promise<void>(() => {})); const handler = vi.fn(() => new Response());
        const body = new ReadableStream<Uint8Array>({ cancel });
        const endpoint = defineApi({ timeoutMs: 15, input: { body: input.object({}) }, handler });
        const incoming = request(undefined, '', { body, duplex: 'half' } as RequestInit);
        await failure(await app(endpoint).fetch(incoming), 504, 'COSSACK_API_TIMEOUT');
        expect(cancel).toHaveBeenCalledOnce(); expect(handler).not.toHaveBeenCalled();
        expect(incoming.body!.locked).toBe(false);
    });

    it('rejects an already disconnected request before parsing or handler work', async () => {
        const controller = new AbortController(); controller.abort(); const handler = vi.fn(() => new Response());
        const endpoint = defineApi({ handler });
        await failure(await app(endpoint).fetch(request(undefined, '', { signal: controller.signal })), 499, 'COSSACK_API_CANCELLED');
        expect(handler).not.toHaveBeenCalled();
    });

    it('checks elapsed time before accepting headers and cancels a response produced after the deadline', async () => {
        let now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now);
        const cancel = vi.fn();
        const endpoint = defineApi({ timeoutMs: 1000, handler: () => {
            // The timer cannot run while this synchronous callback owns the turn.
            now = 2000; return new Response(new ReadableStream({ cancel }));
        } });
        await failure(await app(endpoint).fetch(request(undefined)), 504, 'COSSACK_API_TIMEOUT');
        expect(cancel).toHaveBeenCalledOnce();
    });

    it('aborts during authorization and cancels a late handler response', async () => {
        const controller = new AbortController(); let release!: (value: boolean) => void; let entered!: () => void;
        const started = new Promise<void>(resolve => entered = resolve); const handler = vi.fn(() => new Response());
        const endpoint = defineApi({ authorize: ({ signal }) => { expect(signal.aborted).toBe(false); entered(); return new Promise<boolean>(resolve => release = resolve); }, handler });
        const pending = app(endpoint).fetch(request(undefined, '', { signal: controller.signal }));
        await started; controller.abort(); await failure(await pending, 499, 'COSSACK_API_CANCELLED');
        release(true); await Promise.resolve(); expect(handler).not.toHaveBeenCalled();
        const cancel = vi.fn(); let resolveResponse!: (value: Response) => void;
        const late = defineApi({ timeoutMs: 15, handler: () => new Promise<Response>(resolve => resolveResponse = resolve) });
        await failure(await app(late).fetch(request(undefined)), 504, 'COSSACK_API_TIMEOUT');
        resolveResponse(new Response(new ReadableStream({ cancel }))); await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    });

    it('snapshots options and rejects malformed declarations without invoking accessors', async () => {
        const getter = vi.fn(); expect(() => defineApi(Object.defineProperty({}, 'handler', { get: getter }) as any)).toThrow('configuration'); expect(getter).not.toHaveBeenCalled();
        for (const config of [{ timeoutMs: 0 }, { timeoutMs: Infinity }, { maxBodyBytes: -1 }, { input: { headers: input.string() } },
            { queryArrays: ['x'] }, { input: null }, { queryArrays: null }, { input: { body: {} } }, { output: {} }, { authorize: true }]) {
            expect(() => defineApi({ handler: () => new Response(), ...config } as any)).toThrow('configuration');
        }
        const definition = { input: { body: input.string() }, handler: () => new Response('snapshot') };
        const endpoint = defineApi(definition); definition.input.body = input.number() as any; definition.handler = () => new Response('changed');
        expect(await (await app(endpoint).fetch(request('ok'))).text()).toBe('snapshot');
    });
});

it('does not retain a caller-selected custom HTTP method as a log label', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const endpoint = defineApi({ handler: () => { throw new Error('private-method-error'); } });
    const response = await app(endpoint).request('/items/a', { method: 'PRIVATE_METHOD_SENTINEL' });
    expect(response.status).toBe(500);
    expect(logged.mock.calls[0][0]).toMatchObject({ action: 'unknown', event: 'cossack.api.failure' });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('PRIVATE_METHOD_SENTINEL');
});
