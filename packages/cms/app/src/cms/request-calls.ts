import type { Context } from 'hono';
import { getRequestContext } from '@cossackframework/core';

declare module 'hono' {
    interface ContextVariableMap {
        /** Ends the database calls this request started (see `requestCallsSignal`). */
        'cms.requestCalls'?: AbortController;
        /** The request's answer is made: work that runs after it is left alone. */
        'cms.answered'?: boolean;
    }
}

/**
 * The signal of the current request's database calls, for `requestSignal` of the CMS's
 * databases on a runtime that cancels a request's I/O when the request ends (Workers).
 *
 * One database client serves every request to a site in an isolate, and it allows 32 calls in
 * flight. A call gives its place back when it settles; on Workers it never settles when its
 * request ends first: the visitor left, or the request failed while other calls of the same
 * `Promise.all` were in flight. So the calls end with the request (`withRequestCalls`). Work
 * that runs after the answer (the outbox, maintenance, under `waitUntil`) gets no signal.
 */
export function requestCallsSignal(): AbortSignal | undefined {
    const c = getRequestContext();
    return c && c.get('cms.answered') !== true ? c.get('cms.requestCalls')?.signal : undefined;
}

/**
 * Answer a request with its own database calls' lifetime: they end when the visitor leaves
 * (the request's signal, with `enable_request_signal` on Workers) or when the request fails
 * (it throws or answers 5xx). Call `answered(c)` once the answer is made, before starting work
 * that outlives it.
 */
export async function withRequestCalls<T>(c: Context, run: () => Promise<T>): Promise<T> {
    const calls = new AbortController();
    c.set('cms.requestCalls', calls);
    const signal = c.req.raw.signal as AbortSignal | undefined;
    const left = () => calls.abort(new Error('The visitor left before the answer.'));
    signal?.addEventListener('abort', left, { once: true });
    let failed = false;
    try {
        return await run();
    } catch (error) {
        failed = true;
        throw error;
    } finally {
        signal?.removeEventListener('abort', left);
        answered(c);
        if (failed || c.error || c.res.status >= 500) calls.abort(new Error('The request failed.'));
    }
}

/** The answer is made: later database calls of this request (work after the answer) take no signal. */
export function answered(c: Context): void {
    c.set('cms.answered', true);
}
