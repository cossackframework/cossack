import { Context, type MiddlewareHandler } from 'hono';
import { assertResponseHeadersMutable, getLocale, getLocaleCatalog, RESPONSE_HEADER_STATE_KEY } from '@cossackframework/core';
import configuredMiddlewares from 'virtual:cossack-middlewares';
import configFactories from 'virtual:cossack-config';
import { ensureRequestContextAlsWired, runWithContext } from './request-context-als.js';
import { withRuntimeRouteParams } from './runtime-websocket.js';
import { buildConfig, runWithConfig, type EnvFunction } from './config.js';
import { ensureLocaleAlsWired, runWithLocale } from './i18n-context.js';

/** Structural auth protocol: the framework does not depend on the auth package. */
export interface RealtimeIdentity {
    version: 1;
    provider: string;
    data: unknown;
}

/** Configuration failures differ from temporary provider/storage failures. */
export class RealtimeIdentityConfigurationError extends TypeError {}

function cloneJson(value: unknown, depth = 0, budget = { visits: 0 }): unknown {
    if (++budget.visits > 128) throw new RealtimeIdentityConfigurationError('Realtime identity is too large.');
    if (depth > 16) throw new RealtimeIdentityConfigurationError('Realtime identity exceeds nesting limits.');
    if (typeof value === 'string' && value.length > 1024) throw new RealtimeIdentityConfigurationError('Realtime identity is too large.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' ||
        (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
        throw new RealtimeIdentityConfigurationError('Realtime identity must contain plain JSON data.');
    }
    const copy: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : Object.create(null);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some(key => typeof key === 'symbol') || Object.keys(descriptors).length > 128) {
        throw new RealtimeIdentityConfigurationError('Realtime identity is too large or contains symbol keys.');
    }
    if (Array.isArray(value) && Object.keys(descriptors).length !== value.length + 1) throw new RealtimeIdentityConfigurationError('Realtime identity arrays must be dense.');
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if (Array.isArray(value) && key === 'length') continue;
        if (!('value' in descriptor) || !descriptor.enumerable || ['__proto__', 'constructor', 'prototype'].includes(key)) {
            throw new RealtimeIdentityConfigurationError('Realtime identity cannot contain accessors or reserved keys.');
        }
        Object.defineProperty(copy, key, { value: cloneJson(descriptor.value, depth + 1, budget), enumerable: true, writable: true, configurable: true });
    }
    return copy;
}

export async function captureRealtimeIdentity(c: Context): Promise<RealtimeIdentity | null> {
    const user = c.get('user');
    if (!user) return null;
    if (typeof user.id !== 'string' || !user.id) throw new RealtimeIdentityConfigurationError('Realtime authentication needs a user ID.');
    const capture = c.get('cossack.captureRealtimeIdentity');
    if (typeof capture !== 'function') throw new RealtimeIdentityConfigurationError('Authenticated realtime needs a revalidation provider.');
    const identity = cloneJson(await capture()) as RealtimeIdentity;
    if (!identity || identity.version !== 1 || typeof identity.provider !== 'string' ||
        !/^[a-z][a-z0-9._-]{0,63}$/.test(identity.provider) || !Object.hasOwn(identity, 'data') ||
        new TextEncoder().encode(JSON.stringify(identity)).length > 1024) throw new RealtimeIdentityConfigurationError('Invalid realtime identity descriptor.');
    return identity;
}

/** Run each check in a fresh request/ORM scope, without replaying bearer headers. */
export async function revalidateRealtimeIdentity(
    original: Context,
    params: Record<string, string>,
    identity: RealtimeIdentity | null,
    middlewares: readonly MiddlewareHandler[],
    check: (context: Context) => boolean | Promise<boolean>,
    locale = getLocale(),
): Promise<boolean> {
    const headers = new Headers(original.req.raw.headers);
    for (const name of ['cookie', 'authorization', 'proxy-authorization', 'set-cookie', 'x-user-id', 'x-user-data',
        'x-api-key', 'x-auth-token', 'x-component-path', 'x-provider-name', 'connection', 'upgrade']) headers.delete(name);
    const c = withRuntimeRouteParams(new Context(new Request(original.req.url, { headers }), {
        env: original.env, path: original.req.path,
    }), params);
    try { c.set('cossack.realtimeIdentity', cloneJson(identity ?? { version: 1, provider: '', data: null })); }
    catch { return false; }
    c.set(RESPONSE_HEADER_STATE_KEY, { committed: true });
    const writeHeader = c.header.bind(c);
    c.header = (name, value, options) => { assertResponseHeadersMutable(c); writeHeader(name, value, options); };
    ensureRequestContextAlsWired();
    let allowed = false;
    let index = -1;
    const stack = [...configuredMiddlewares, ...middlewares];
    const dispatch = async (position: number): Promise<void> => {
        if (position <= index) throw new Error('next() called multiple times');
        index = position;
        const middleware = stack[position];
        if (!middleware) { allowed = await check(c); return; }
        const response = await middleware(c, () => dispatch(position + 1));
        if (response) allowed = false;
    };
    try {
        const env = original.env as Record<string, unknown>;
        const envFn: EnvFunction = (key, fallback) => env?.[key] === undefined || env[key] === null ? fallback ?? '' : String(env[key]);
        const config = buildConfig(configFactories as Record<string, unknown>, envFn);
        ensureLocaleAlsWired();
        await runWithContext(c, () => runWithConfig({ env, config }, () =>
            runWithLocale({ locale, messages: getLocaleCatalog(locale) ?? {} }, () => dispatch(0))));
    }
    catch { return false; }
    return allowed;
}
