import { Context } from 'hono';
import type { ConfigRequirementContext } from './config-requirements.js';
import { getLocale } from '@cossackframework/core';

/** Structural auth protocol: the framework does not depend on the auth package. */
export interface RealtimeIdentity {
    version: 1;
    provider: string;
    data: unknown;
}

export interface RealtimeRequestSnapshot {
    url: string;
    path: string;
    headers: [string, string][];
    env: unknown;
    params: Record<string, string>;
    locale: string;
    configContext?: Pick<ConfigRequirementContext, 'runtime' | 'environment'>;
}

/** Configuration failures differ from temporary provider/storage failures. */
export class RealtimeIdentityConfigurationError extends TypeError {}

export function cloneRealtimeIdentity(value: unknown, depth = 0, budget = { visits: 0 }): unknown {
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
        Object.defineProperty(copy, key, { value: cloneRealtimeIdentity(descriptor.value, depth + 1, budget), enumerable: true, writable: true, configurable: true });
    }
    return copy;
}

export async function captureRealtimeIdentity(c: Context): Promise<RealtimeIdentity | null> {
    const user = c.get('user');
    if (!user) return null;
    if (typeof user.id !== 'string' || !user.id) throw new RealtimeIdentityConfigurationError('Realtime authentication needs a user ID.');
    const capture = c.get('cossack.captureRealtimeIdentity');
    if (typeof capture !== 'function') throw new RealtimeIdentityConfigurationError('Authenticated realtime needs a revalidation provider.');
    const identity = cloneRealtimeIdentity(await capture()) as RealtimeIdentity;
    if (!identity || identity.version !== 1 || typeof identity.provider !== 'string' ||
        !/^[a-z][a-z0-9._-]{0,63}$/.test(identity.provider) || !Object.hasOwn(identity, 'data') ||
        new TextEncoder().encode(JSON.stringify(identity)).length > 1024) throw new RealtimeIdentityConfigurationError('Invalid realtime identity descriptor.');
    return identity;
}

/** Retain only request facts needed for later checks. Credential headers are discarded immediately. */
export function snapshotRealtimeRequest(c: Context, params: Record<string, string>, locale = getLocale()): RealtimeRequestSnapshot {
    const headers = new Headers(c.req.raw.headers);
    for (const name of ['cookie', 'authorization', 'proxy-authorization', 'set-cookie', 'x-user-id', 'x-user-data',
        'x-api-key', 'x-auth-token', 'x-component-path', 'connection', 'upgrade']) headers.delete(name);
    const configContext = c.get('cossack.configContext') as RealtimeRequestSnapshot['configContext'];
    return { url: c.req.url, path: c.req.path, headers: [...headers], env: c.env, params: { ...params }, locale,
        ...(configContext ? { configContext: { runtime: configContext.runtime, ...(configContext.environment !== undefined ? { environment: configContext.environment } : {}) } } : {}) };
}
