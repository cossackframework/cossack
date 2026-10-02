// src/server.ts
//
// Server-side test entry (RT-29): run test code inside the same request
// facilities production uses — per-request AsyncLocalStorage scopes for the
// Hono request context, config, and DI services — plus deterministic async
// control for testing slow responses, cancellation, and cleanup ordering.
//
// Core-only dependency: these helpers exercise the production scoping that
// core owns (request-context getter, config store injection, service scopes)
// without requiring the framework's router.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Context } from 'hono';
import {
    createRootServiceScope,
    setRequestContextGetter,
    __resetRequestContextForTests,
    type ServiceScope,
    type ServiceScopeRequestContext,
} from '@cossackframework/core';

export interface RequestScopeOptions extends ServiceScopeRequestContext {
    // NOTE: config() / env() / binding() scoping is owned by the framework's
    // config ALS (packages/framework/src/config.ts); these helpers stay
    // core-only and scope what core owns — the Hono request context and DI
    // service scopes.
}

/**
 * Run `fn` inside production-like request scoping for what core owns:
 * `getRequestContext()` resolves the supplied Hono `Context`, and the created
 * root service scope carries `user`/`env`/`context` for scoped services. The
 * scope is disposed (awaited) after `fn` settles, so `onDispose` hooks run
 * deterministically per test.
 */
export async function withRequestScope<T>(
    options: RequestScopeOptions,
    fn: (scope: { serviceScope: ServiceScope }) => Promise<T> | T,
): Promise<T> {
    const requestAls = new AsyncLocalStorage<Context>();
    const previousGetter = (globalThis as any).__cossack_test_prev_getter;
    setRequestContextGetter(() => requestAls.getStore());

    const serviceScope = createRootServiceScope();
    serviceScope.bindRequest({
        context: options.context,
        user: options.user,
        env: options.env,
    });

    try {
        return await requestAls.run(options.context as Context, () => fn({ serviceScope }));
    } finally {
        __resetRequestContextForTests();
        if (previousGetter !== undefined) (globalThis as any).__cossack_test_prev_getter = previousGetter;
        await serviceScope.disposeAsync();
    }
}

/**
 * A deferred promise with an external controller: resolve/reject from the
 * test, observe settlement, and share an abort signal. Use it to simulate
 * slow server responses, cancellation mid-flight, and out-of-order results
 * without real timers.
 *
 * ```ts
 * const slow = controlledAsync<string>();
 * const call = component.load(slow.promise);
 * fast.resolve('fast');            // a newer result lands first
 * expect(await call).toBe('fast'); // the stale value cannot win
 * ```
 */
export interface ControlledAsync<T> {
    readonly promise: Promise<T>;
    readonly signal: AbortSignal;
    readonly settled: boolean;
    resolve(value: T): void;
    reject(reason?: unknown): void;
    cancel(): void;
}

export function controlledAsync<T>(options: { timeoutMs?: number } = {}): ControlledAsync<T> {
    let resolveFn!: (value: T | PromiseLike<T>) => void;
    let rejectFn!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
    });
    const controller = new AbortController();
    let settled = false;
    const settle = <A extends unknown[]>(action: (...args: A) => void) => (...args: A) => {
        if (settled || controller.signal.aborted) return;
        settled = true;
        action(...args);
    };
    if (options.timeoutMs !== undefined) {
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                rejectFn(new Error(`controlledAsync timed out after ${options.timeoutMs}ms`));
            }
        }, options.timeoutMs);
        // Node timers expose unref so the handle never keeps a test runner
        // alive; browsers return a number with no such method.
        (timer as { unref?: () => void }).unref?.();
    }
    void promise.catch(() => { /* observed by the caller; never unhandled */ });
    return {
        promise,
        signal: controller.signal,
        get settled() { return settled; },
        resolve: settle(resolveFn),
        reject: settle(rejectFn),
        cancel: () => {
            if (settled) return;
            settled = true;
            controller.abort();
            rejectFn(new Error('controlledAsync was cancelled'));
        },
    };
}
