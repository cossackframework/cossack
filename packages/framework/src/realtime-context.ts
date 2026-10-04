import { Context, type MiddlewareHandler } from 'hono';
import { assertResponseHeadersMutable, getLocaleCatalog, RESPONSE_HEADER_STATE_KEY } from '@cossackframework/core';
import configuredMiddlewares from 'virtual:cossack-middlewares';
import configFactories from 'virtual:cossack-config';
import { ensureRequestContextAlsWired, runWithContext } from './request-context-als.js';
import { withRuntimeRouteParams } from './runtime-websocket.js';
import { buildConfig, runWithConfig, type EnvFunction } from './config.js';
import { ensureLocaleAlsWired, runWithLocale } from './i18n-context.js';
import { cloneRealtimeIdentity, snapshotRealtimeRequest, type RealtimeIdentity, type RealtimeRequestSnapshot } from './realtime-identity.js';

export { captureRealtimeIdentity, RealtimeIdentityConfigurationError, snapshotRealtimeRequest } from './realtime-identity.js';
export type { RealtimeIdentity, RealtimeRequestSnapshot } from './realtime-identity.js';

function contextFromSnapshot(snapshot: RealtimeRequestSnapshot): Context {
    return withRuntimeRouteParams(new Context(new Request(snapshot.url, { headers: snapshot.headers }), {
        env: snapshot.env, path: snapshot.path,
    }), snapshot.params);
}

/** Run each check in a fresh request/ORM scope, without replaying bearer headers. */
export async function revalidateRealtimeIdentity(
    original: Context | RealtimeRequestSnapshot,
    params: Record<string, string>,
    identity: RealtimeIdentity | null,
    middlewares: readonly MiddlewareHandler[],
    check: (context: Context) => boolean | Promise<boolean>,
    locale?: string,
): Promise<boolean> {
    const snapshot = isRealtimeRequestSnapshot(original) ? original : snapshotRealtimeRequest(original, params, locale);
    return (await withRealtimeAuthorization(snapshot, identity, middlewares, check, async () => true)) !== null;
}

function isRealtimeRequestSnapshot(value: Context | RealtimeRequestSnapshot): value is RealtimeRequestSnapshot {
    return typeof (value as RealtimeRequestSnapshot).url === 'string' && Array.isArray((value as RealtimeRequestSnapshot).headers) &&
        typeof (value as RealtimeRequestSnapshot).path === 'string' && (value as RealtimeRequestSnapshot).params !== undefined;
}

/** Keep fresh middleware, auth resolution and the action in one request scope. */
export async function withRealtimeAuthorization<T>(
    original: RealtimeRequestSnapshot,
    identity: RealtimeIdentity | null,
    middlewares: readonly MiddlewareHandler[],
    check: (context: Context) => boolean | Promise<boolean>,
    operation: (context: Context) => T | Promise<T>,
): Promise<{ context: Context; value: T } | null> {
    const c = contextFromSnapshot(original);
    try { c.set('cossack.realtimeIdentity', cloneRealtimeIdentity(identity ?? { version: 1, provider: '', data: null })); }
    catch { return null; }
    c.set(RESPONSE_HEADER_STATE_KEY, { committed: true });
    const writeHeader = c.header.bind(c);
    c.header = (function(name: string, value?: string, options?: Parameters<Context['header']>[2]) {
        if (arguments.length === 1) return writeHeader(name);
        // Replayed middleware runs after the live response has been committed.
        // Benign response headers are local to this synthetic context and are
        // intentionally discarded; a cookie mutation is a credential side
        // effect and must still fail closed.
        if (name.toLowerCase() === 'set-cookie') assertResponseHeadersMutable(c);
        return c;
    }) as typeof c.header;
    ensureRequestContextAlsWired();
    let outcome: { context: Context; value: T } | null = null;
    let index = -1;
    const stack = [...configuredMiddlewares, ...middlewares];
    let operationStarted = false;
    let operationFailed = false;
    const dispatch = async (position: number): Promise<void> => {
        if (position <= index) throw new Error('next() called multiple times');
        index = position;
        const middleware = stack[position];
        if (!middleware) {
            if (await check(c)) {
                operationStarted = true;
                try { outcome = { context: c, value: await operation(c) }; }
                catch (error) { operationFailed = true; throw error; }
            }
            return;
        }
        const response = await middleware(c, () => dispatch(position + 1));
        if (response && !operationStarted) outcome = null;
    };
    try {
        const env = original.env as Record<string, unknown>;
        const envFn: EnvFunction = (key, fallback) => env?.[key] === undefined || env[key] === null ? fallback ?? '' : String(env[key]);
        const config = buildConfig(configFactories as Record<string, unknown>, envFn);
        ensureLocaleAlsWired();
        await runWithContext(c, () => runWithConfig({ env, config }, () =>
            runWithLocale({ locale: original.locale, messages: getLocaleCatalog(original.locale) ?? {} }, () => dispatch(0))));
    }
    catch (error) {
        if (operationFailed) throw error;
        return null;
    }
    return outcome;
}
