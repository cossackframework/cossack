import type { Context } from 'hono';
import type { PageOptions } from '@cossackframework/core';
import { filePathToHttpRoute, routeParameters } from './route-ids.js';

/** Evaluate a realtime page scope using the request's current authenticated user. */
export async function resolveRealtimeScopeKey(c: Context, pageOptions: PageOptions | undefined): Promise<string> {
    if (pageOptions?.scope) return pageOptions.scope(c);
    const user = c.get('user');
    return `user:${user?.id || 'anonymous'}`;
}

/**
 * What owns a live realtime instance:
 *
 * - `page`: a page file (`/src/pages/.../index.ts`).
 * - `layout`: a layout file (`/src/pages/.../layout.ts`). Every page below it
 *   shares the instance.
 * - `component`: a realtime child component, by its build-time registry id.
 *   Every page that embeds it shares the instance.
 */
export type RealtimeOwnerKind = 'page' | 'layout' | 'component';

export interface RealtimeOwner {
    kind: RealtimeOwnerKind;
    /** Page or layout source path, or the realtime component registry id. */
    id: string;
    options: PageOptions | undefined;
}

/** Longest scope key a realtime owner may use (the Durable Object also checks it). */
export const REALTIME_SCOPE_KEY_MAX_LENGTH = 2048;

/**
 * A realtime scope function returned no usable key, or a realtime component
 * has none. The connection fails closed with 403, like a guard denial.
 */
export class RealtimeScopeError extends Error {
    readonly authorizationCode = 'COSSACK_AUTH_FORBIDDEN';
    readonly code = 'COSSACK_REALTIME_SCOPE_INVALID';
    constructor(message: string) {
        super(message);
        this.name = 'RealtimeScopeError';
    }
}

/**
 * The custom scope key of a realtime owner, checked. A scope function must
 * return a non-empty string; anything else rejects the connection. Without a
 * scope function, pages and layouts use their default identity (`undefined`),
 * but a realtime component has no default: its instance is shared by every
 * page that embeds it, so it must say who shares it.
 */
export async function resolveRealtimeOwnerScope(c: Context, owner: RealtimeOwner): Promise<string | undefined> {
    const scope = owner.options?.scope;
    if (typeof scope !== 'function') {
        if (owner.kind === 'component') throw new RealtimeScopeError('A realtime component needs a scope function.');
        return undefined;
    }
    const key: unknown = await scope(c);
    if (typeof key !== 'string' || !key || key.length > REALTIME_SCOPE_KEY_MAX_LENGTH) {
        throw new RealtimeScopeError('A realtime scope function must return a non-empty string.');
    }
    return key;
}

/**
 * The scope key a realtime connection carries and every action checks again:
 * the checked custom key, or (without a scope function) the per-user default
 * that also names layout services.
 */
export async function realtimeConnectionScopeKey(c: Context, owner: RealtimeOwner): Promise<string> {
    return await resolveRealtimeOwnerScope(c, owner) ?? resolveRealtimeScopeKey(c, undefined);
}

/** Params a layout's own route declares (a layout at `/teams/[team]/layout.ts` declares `team`). */
export function layoutRouteParams(layoutPath: string, params: Record<string, string>): Record<string, string> {
    const declared = routeParameters(filePathToHttpRoute(layoutPath.replace(/\/layout\.ts$/, '/index.ts')));
    const own: Record<string, string> = {};
    for (const { name } of declared) if (Object.hasOwn(params, name)) own[name] = params[name]!;
    return own;
}

/**
 * Name of the live instance (Durable Object name, or the Node runtime key) of
 * a realtime owner. SSR, which emits the target, and every upgrade, which
 * recomputes and compares it, call this.
 *
 * The owner's kind and id are always part of the name, so two owners never
 * share an instance, even when their scope keys are equal, and no scope key can
 * name another owner's instance:
 *
 * - With a scope function, the scope key names the instance.
 * - Without one, a page instance is the page plus its route params (host and
 *   query string do not count), and a layout instance is the layout plus the
 *   params its own route declares, so every page below it shares the instance.
 */
export function realtimeInstanceName(owner: RealtimeOwner, scopeKey: string | undefined, params: Record<string, string>): string {
    if (typeof owner.options?.scope === 'function') {
        if (typeof scopeKey !== 'string' || !scopeKey) throw new RealtimeScopeError('A realtime scope function must return a non-empty string.');
        return `${owner.kind}:${JSON.stringify([owner.id, { scope: scopeKey }])}`;
    }
    if (owner.kind === 'component') throw new RealtimeScopeError('A realtime component needs a scope function.');
    const identity = owner.kind === 'layout' ? layoutRouteParams(owner.id, params) : params;
    const entries = Object.keys(identity).sort().map(key => [key, identity[key]]);
    return `${owner.kind}:${JSON.stringify([owner.id, entries])}`;
}

/**
 * Whether `options` make `kind` a realtime owner. Layouts and child components
 * opt in with the Durable Object transport; pages also keep the generic
 * `websocket` transport.
 */
export function isRealtimeOwner(kind: RealtimeOwnerKind, options: PageOptions | undefined): boolean {
    return options?.transport === 'durable-object' || (kind === 'page' && options?.transport === 'websocket');
}
