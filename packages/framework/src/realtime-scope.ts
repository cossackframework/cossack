import type { Context } from 'hono';
import type { PageOptions } from '@cossackframework/core';

/** Evaluate a realtime page scope using the request's current authenticated user. */
export async function resolveRealtimeScopeKey(c: Context, pageOptions: PageOptions | undefined): Promise<string> {
    if (pageOptions?.scope) return pageOptions.scope(c);
    const user = c.get('user');
    return `user:${user?.id || 'anonymous'}`;
}
