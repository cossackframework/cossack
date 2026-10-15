// src/server.ts
//
// Server-side test entry (RT-29): run test code inside the same request
// facilities production uses — per-request AsyncLocalStorage scopes for the
// Hono request context and DI services — plus deterministic async
// control for testing slow responses, cancellation, and cleanup ordering.
//
// Core-only dependency: these helpers exercise the production scoping that
// core owns (request-context getter and service scopes)
// without requiring the framework's router.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Context } from 'hono';
import { TRANSPORT_ROUTES } from '@cossackframework/core/transport-routes';
import {
    createRootServiceScope,
    setRequestContextGetter,
    type ServiceScope,
    type ServiceScopeRequestContext,
} from '@cossackframework/core';

const requestAls = new AsyncLocalStorage<RequestScopeOptions>();
let activeScopes = 0;
let previousGetter: (() => Context | undefined) | null = null;

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
    if (activeScopes++ === 0) {
        previousGetter = setRequestContextGetter(() => {
            const scope = requestAls.getStore();
            return scope ? scope.context : previousGetter?.();
        });
    }

    try {
        return await requestAls.run(options, async () => {
            const serviceScope = createRootServiceScope();
            serviceScope.bindRequest(options);
            try { return await fn({ serviceScope }); }
            finally { await serviceScope.disposeAsync(); }
        });
    } finally {
        if (--activeScopes === 0) {
            setRequestContextGetter(previousGetter);
            previousGetter = null;
        }
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
 * slow.resolve('ready');
 * expect(await call).toBe('ready');
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
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)) {
        throw new TypeError('controlledAsync timeoutMs must be a finite nonnegative number.');
    }
    let resolveFn!: (value: T | PromiseLike<T>) => void;
    let rejectFn!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
    });
    const controller = new AbortController();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = <A extends unknown[]>(action: (...args: A) => void) => (...args: A) => {
        if (settled || controller.signal.aborted) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        action(...args);
    };
    if (options.timeoutMs !== undefined) {
        timer = setTimeout(() => {
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
            if (timer !== undefined) clearTimeout(timer);
            controller.abort();
            rejectFn(new Error('controlledAsync was cancelled'));
        },
    };
}

export interface ServerAppOptions<Env> {
    /** Inject the real framework app.fetch or generated Worker.fetch. */
    fetch: (request: Request, env: Env) => Response | Promise<Response>;
    env: Env;
    baseUrl?: string;
}

export interface ComponentRpcRequest {
    componentRouteId: string;
    action: string;
    payload?: unknown[];
    state?: Record<string, unknown>;
    scopeKey?: string;
    target?: string;
    /** Route params of the page the call runs under. Defaults to none. */
    pageParams?: Record<string, string>;
    /** For a layout component: route id of the page the call runs under. */
    pageRouteId?: string;
}

export interface ServiceRpcRequest {
    ownerRouteId: string;
    slot: string;
    /** Route id of the page the call runs under. The owning layout must enclose it. */
    componentRouteId: string;
    /** Route params of that page. Defaults to none. */
    pageParams?: Record<string, string>;
    action: string;
    payload?: unknown[];
    state?: Record<string, unknown>;
}

/** Real request dispatch: no alternate router, policy, DI, or cleanup implementation. */
export function createServerApp<Env>(options: ServerAppOptions<Env>) {
    const base = new URL(options.baseUrl ?? 'http://localhost');
    if (!['http:', 'https:'].includes(base.protocol)) throw new TypeError('Server app baseUrl must use HTTP or HTTPS.');
    const request = async (input: string | Request, init?: RequestInit): Promise<Response> => {
        const req = input instanceof Request ? new Request(input, init) : new Request(new URL(input, base), init);
        return options.fetch(req, options.env);
    };
    const rpc = (body: Record<string, unknown>, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        if (!headers.has('Origin')) headers.set('Origin', base.origin);
        headers.set('Content-Type', 'application/json');
        return request(TRANSPORT_ROUTES.rpc, { ...init, method: 'POST', headers, body: JSON.stringify(body) });
    };
    return {
        request,
        componentRpc: (body: ComponentRpcRequest, init?: RequestInit) => rpc({ payload: [], state: {}, ...body }, init),
        serviceRpc: ({ ownerRouteId, slot, ...body }: ServiceRpcRequest, init?: RequestInit) =>
            rpc({ payload: [], state: {}, pageParams: {}, ...body, service: { ownerRouteId, slot } }, init),
    };
}

/** Credentials only: the production application's authentication and policies still decide access. */
export function authFixture(options: { headers?: HeadersInit; cookies?: Record<string, string> } = {}): { headers: Headers } {
    const headers = new Headers(options.headers);
    const cookies = Object.entries(options.cookies ?? {}).map(([name, value]) => {
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new TypeError('Invalid fixture cookie name.');
        return `${name}=${encodeURIComponent(value)}`;
    });
    if (cookies.length) headers.set('Cookie', [headers.get('Cookie'), cookies.join('; ')].filter(Boolean).join('; '));
    return { headers };
}

/** Parse the production JSON hydration assignment. Never evaluate application JavaScript. */
export function readHydrationState<T = Record<string, unknown>>(html: string): T | undefined {
    const matches = [...html.matchAll(/<script\b[^>]*>\s*window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script\s*>/gi)];
    if (!matches.length) return undefined;
    if (matches.length !== 1) throw new Error('Ambiguous hydration state: multiple assignments.');
    const serialized = matches[0][1].trim().replace(/;\s*$/, '');
    return JSON.parse(serialized) as T;
}
