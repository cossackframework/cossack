import type { Context } from 'hono';
import type { PageOptions } from '@cossackframework/core';

/** Evaluate a realtime page scope using the request's current authenticated user. */
export async function resolveRealtimeScopeKey(c: Context, pageOptions: PageOptions | undefined): Promise<string> {
    if (pageOptions?.scope) return pageOptions.scope(c);
    const user = c.get('user');
    return `user:${user?.id || 'anonymous'}`;
}

/**
 * Durable Object name for a `durable-object` page. A custom `scope` names the
 * object by its scope key. Otherwise each page instance (component plus route
 * params) gets one object, independent of host and query string. SSR (which
 * emits the id) and the WebSocket proxy (which verifies it) both call this.
 */
export function realtimeObjectName(
    pageOptions: PageOptions | undefined,
    scopeKey: string,
    componentPath: string,
    params: Record<string, string>,
): string {
    if (pageOptions?.scope) return scopeKey;
    const entries = Object.keys(params).sort().map(key => [key, params[key]]);
    return `page:${JSON.stringify([componentPath, entries])}`;
}
