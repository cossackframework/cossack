/** Declared native HTTP contracts. This entry uses only portable Web APIs. */
import type { Context } from 'hono';
import { createServerFailureContext, logServerFailure } from './server-logging.js';
import { discardRequestBody, readBoundedBody } from './request-body.js';
import { HTTPException } from 'hono/http-exception';
import { getAuthorizationFailure, isActionValidationError, isClientVisibleError, isInputSchema,
    snapshotRpcValue, type InputOf, type InputSchema, type RawInputOf, type RpcSerialized } from '@cossackframework/core';

export type ApiSchemas = { params?: InputSchema<any, any>; query?: InputSchema<any, any>; body?: InputSchema<any, any> };
type Parsed<S extends ApiSchemas> = { [K in keyof S]: NonNullable<S[K]> extends InputSchema<any, any> ? InputOf<NonNullable<S[K]>> : never };
type Raw<S extends ApiSchemas> = { [K in keyof S]: NonNullable<S[K]> extends InputSchema<any, any> ? RawInputOf<NonNullable<S[K]>> : never };
type ArrayKeys<S extends ApiSchemas> = 'query' extends keyof S ? {
    [K in keyof RawInputOf<NonNullable<S['query']>>]: NonNullable<RawInputOf<NonNullable<S['query']>>[K]> extends readonly unknown[] ? K : never
}[keyof RawInputOf<NonNullable<S['query']>>] & string : never;
export interface ApiContext<I> { input: I; c: Context; signal: AbortSignal; }
declare const CONTRACT: unique symbol;
/** A native Hono handler, with type-only parsed/raw/wire contracts. */
export type ApiHandler<I, R, O> = ((c: Context) => Promise<Response>) & {
    readonly [CONTRACT]: { input: I; raw: R; output: O };
};
export type ApiInput<H> = H extends ApiHandler<infer I, any, any> ? I : unknown;
export type ApiRawInput<H> = H extends ApiHandler<any, infer R, any> ? R : unknown;
export type ApiOutput<H> = H extends ApiHandler<any, any, infer O> ? O : unknown;
/** The router gives a default function precedence over named HTTP handlers. */
export type ApiMethods<M> = M extends { default: infer Default } ? Default extends (...args: any[]) => any ? { '*': Default } : {}
    : Pick<M, Extract<keyof M, 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'>>;

interface Common<S extends ApiSchemas> {
    input?: S & { [K in Exclude<keyof S, keyof ApiSchemas>]: never };
    /** Repeated scalar query keys reject. Listed array keys stay arrays even with one value. */
    queryArrays?: readonly ArrayKeys<S>[];
    authorize?: (context: ApiContext<Parsed<S>>) => boolean | Promise<boolean>;
    /** Time to produce headers/JSON, including parsing and authorization. Default: 10 seconds. */
    timeoutMs?: number;
    /** Actual streamed JSON request bytes. Default: 1 MiB; maximum: 16 MiB. */
    maxBodyBytes?: number;
}
export function defineApi<const S extends ApiSchemas = {}, O extends InputSchema<any, any> = never>(
    definition: Common<S> & { output: O; handler: (context: ApiContext<Parsed<S>>) => InputOf<NoInfer<O>> | Promise<InputOf<NoInfer<O>>> },
): ApiHandler<Parsed<S>, Raw<S>, RpcSerialized<InputOf<O>>>;
export function defineApi<const S extends ApiSchemas = {}>(
    definition: Common<S> & { output?: never; handler: (context: ApiContext<Parsed<S>>) => Response | Promise<Response> },
): ApiHandler<Parsed<S>, Raw<S>, Response>;
export function defineApi(definition: Common<ApiSchemas> & { output?: InputSchema<any, any>; handler: (context: ApiContext<any>) => unknown }): ApiHandler<any, any, any> {
    const config = configuration(definition);
    return (async (c: Context) => {
        const action = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(c.req.method) ? c.req.method : 'unknown';
        const logContext = createServerFailureContext(c, { action });
        const requestId = logContext.requestId;
        const controller = new AbortController();
        const disconnect = () => controller.abort(new ApiFailure(499, 'COSSACK_API_CANCELLED', 'Request cancelled.'));
        const signal = controller.signal;
        c.req.raw.signal.addEventListener('abort', disconnect, { once: true });
        if (c.req.raw.signal.aborted) disconnect();
        const deadline = performance.now() + config.timeoutMs;
        const timeout = () => controller.abort(new ApiFailure(504, 'COSSACK_API_TIMEOUT', 'Request timed out.'));
        const timer = setTimeout(timeout, config.timeoutMs);
        let stage: 'input' | 'authorize' | 'handler' | 'output' = 'input';
        const check = () => {
            if (!signal.aborted && performance.now() >= deadline) timeout();
            if (signal.aborted) throw signal.reason;
        };
        try {
            check();
            const input: Record<string, unknown> = Object.create(null);
            for (const [location, schema] of Object.entries(config.input)) {
                check();
                const raw = location === 'body' ? await readJsonBody(c.req.raw, config.maxBodyBytes, signal)
                    : location === 'params' ? c.req.param() : readQuery(c.req.url, config.queryArrays);
                try { input[location] = await owned(() => schema.parse(raw, { signal }), signal); }
                catch (error) {
                    if (isActionValidationError(error)) throw new ApiFailure(400, 'COSSACK_VALIDATION_FAILED', 'Validation failed.', { [location]: error.fieldErrors });
                    throw error;
                }
            }
            const context = { input, c, signal };
            check();
            stage = 'authorize';
            if (config.authorize && await owned(() => config.authorize!(context), signal) !== true) {
                throw new ApiFailure(403, 'COSSACK_AUTH_FORBIDDEN', 'Forbidden');
            }
            check();
            stage = 'handler';
            const value = await owned(() => config.handler(context), signal);
            try { check(); } catch (error) { cancelBody(value); throw error; }
            stage = 'output';
            if (!config.output) {
                if (!(value instanceof Response)) throw new Error('Native API handler must return a Response.');
                return preserveResponse(c, value);
            }
            if (value instanceof Response) {
                cancelBody(value);
                throw new Error('A JSON API contract cannot return a native Response.');
            }
            const parsed = await owned(() => config.output!.parse(value, { signal }), signal);
            check();
            const serialized = JSON.stringify(snapshotRpcValue(parsed));
            if (serialized === undefined) throw new Error('API output must have a JSON representation.');
            check();
            return c.newResponse(serialized, { headers: { 'Content-Type': 'application/json; charset=UTF-8' } });
        } catch (error) {
            // An output schema failure is a server bug, never a public input error.
            const denial = stage !== 'output' && getAuthorizationFailure(error);
            const failure = signal.aborted ? signal.reason
                : error instanceof ApiFailure ? error
                : denial ? new ApiFailure(denial.status, denial.code, denial.message)
                : stage === 'handler' && isClientVisibleError(error) ? new ApiFailure(400, 'COSSACK_API_REJECTED', error.message)
                : null;
            if (failure instanceof ApiFailure) {
                c.header('X-Cossack-Request-Id', requestId);
                const response = new Response(JSON.stringify({ error: failure.message, code: failure.code, requestId,
                    ...(failure.fieldErrors ? { fieldErrors: failure.fieldErrors } : {}) }),
                    { status: failure.status, headers: { 'Content-Type': 'application/json; charset=UTF-8' } });
                return c.newResponse(response.body, response);
            }
            if (stage === 'handler' && error instanceof HTTPException) {
                const original = error.getResponse();
                const response = preserveResponse(c, original);
                response.headers.set('X-Cossack-Request-Id', requestId);
                return response;
            }
            logServerFailure(logContext, 'api', stage, 'COSSACK_API_INTERNAL');
            c.header('X-Cossack-Request-Id', requestId);
            return c.json({ error: 'Internal Server Error', code: 'COSSACK_API_INTERNAL', requestId }, 500);
        } finally {
            clearTimeout(timer);
            c.req.raw.signal.removeEventListener('abort', disconnect);
        }
    }) as ApiHandler<any, any, any>;
}

class ApiFailure extends Error {
    constructor(readonly status: 400 | 401 | 403 | 413 | 415 | 499 | 500 | 504,
        readonly code: string, message: string, readonly fieldErrors?: Record<string, unknown>) { super(message); }
}
function configuration(definition: any) {
    const fail = (): never => { throw new Error('[Cossack] Invalid API contract configuration.'); };
    const record = (value: any, keys: string[]) => {
        if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
        const copy: any = Object.create(null);
        for (const key of Reflect.ownKeys(value)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
            if (typeof key !== 'string' || !keys.includes(key) || !('value' in descriptor)) fail();
            copy[key] = descriptor.value;
        }
        return copy;
    };
    const copy = record(definition, ['input', 'output', 'handler', 'authorize', 'timeoutMs', 'maxBodyBytes', 'queryArrays']);
    const input = record(copy.input === undefined ? {} : copy.input, ['params', 'query', 'body']) as Record<string, InputSchema<any, any>>;
    if (Object.values(input).some(schema => !isInputSchema(schema)) || copy.output !== undefined && !isInputSchema(copy.output)
        || typeof copy.handler !== 'function' || copy.authorize !== undefined && typeof copy.authorize !== 'function') fail();
    const bounded = (value: unknown, fallback: number, max: number) => {
        const result = value === undefined ? fallback : value;
        if (typeof result !== 'number' || !Number.isInteger(result) || result < 1 || result > max) fail();
        return result as number;
    };
    const queryArrays = copy.queryArrays === undefined ? [] : copy.queryArrays;
    if (!Array.isArray(queryArrays) || queryArrays.length > 1024 || queryArrays.some(key => typeof key !== 'string' || !key)
        || new Set(queryArrays).size !== queryArrays.length || queryArrays.length && !input.query) fail();
    return Object.freeze({ input: Object.freeze(input), output: copy.output as InputSchema<any, any> | undefined,
        handler: copy.handler as (context: ApiContext<any>) => unknown,
        authorize: copy.authorize as Common<ApiSchemas>['authorize'], queryArrays: new Set<string>(queryArrays),
        timeoutMs: bounded(copy.timeoutMs, 10_000, 300_000), maxBodyBytes: bounded(copy.maxBodyBytes, 1024 * 1024, 16 * 1024 * 1024) });
}
function cancelBody(value: unknown) {
    if (value instanceof Response && value.body && !value.body.locked) void value.body.cancel().catch(() => {});
}
function preserveResponse(c: Context, response: Response) {
    const headers = new Headers(response.headers);
    const cookies = [...new Set([...c.res.headers.getSetCookie(), ...headers.getSetCookie()])];
    // Hono merges context cookies again when a middleware chain finalizes.
    // Keep one combined list on that context rather than appending it twice.
    if (cookies.length) {
        c.res.headers.delete('Set-Cookie');
        for (const cookie of cookies) c.res.headers.append('Set-Cookie', cookie);
        headers.delete('Set-Cookie');
    }
    return c.newResponse(response.body, new Response(null, { status: response.status, headers }));
}
/** Observe abandoned callbacks and cancel a late native body without waiting for ignored application I/O. */
function owned<T>(run: () => T | PromiseLike<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
        let settled = false;
        const abort = () => { settled = true; signal.removeEventListener('abort', abort); reject(signal.reason); };
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve().then(() => { if (signal.aborted) throw signal.reason; return run(); }).then(value => {
            signal.removeEventListener('abort', abort);
            if (settled || signal.aborted) { cancelBody(value); if (!settled) reject(signal.reason); }
            else { settled = true; resolve(value); }
        }, error => { signal.removeEventListener('abort', abort); if (!settled) { settled = true; reject(error); } });
    });
}
function readQuery(url: string, arrays: ReadonlySet<string>) {
    const query = new URL(url).search;
    if (new TextEncoder().encode(query).byteLength > 64 * 1024) throw new ApiFailure(413, 'COSSACK_API_INPUT_TOO_LARGE', 'Request input is too large.');
    const result: Record<string, string | string[]> = Object.create(null);
    let count = 0;
    for (const [key, value] of new URLSearchParams(query)) {
        if (++count > 1024) throw new ApiFailure(413, 'COSSACK_API_INPUT_TOO_LARGE', 'Request input is too large.');
        if (arrays.has(key)) {
            if (!Object.hasOwn(result, key)) result[key] = [];
            (result[key] as string[]).push(value);
        }
        else if (Object.hasOwn(result, key)) throw new ApiFailure(400, 'COSSACK_API_QUERY_REPEATED', 'Repeated query parameters require an array declaration.');
        else result[key] = value;
    }
    return result;
}
async function readJsonBody(request: Request, limit: number, signal: AbortSignal): Promise<unknown> {
    if (!request.body) return undefined;
    const media = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
    if (!media || !(media === 'application/json' || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(media))) {
        await discardRequestBody(request, limit);
        throw new ApiFailure(415, 'COSSACK_API_MEDIA_TYPE', 'Expected a JSON request body.');
    }
    const bytes = await readBoundedBody(request.body, limit,
        () => new ApiFailure(413, 'COSSACK_API_INPUT_TOO_LARGE', 'Request input is too large.'),
        reader => owned(() => reader.read(), signal));
    if (!bytes.byteLength) return undefined;
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new ApiFailure(400, 'COSSACK_API_JSON_INVALID', 'Malformed JSON request body.'); }
}
