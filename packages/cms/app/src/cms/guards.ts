import { defineServerMiddleware } from '@cossackframework/core';
import { isTransportPath } from '@cossackframework/core/transport-routes';
import { ANONYMOUS, hasPermission, type Principal } from '@cossackframework/cms';
import type { Context } from 'hono';

const principal = (c: Context): Principal => c.get('principal') ?? ANONYMOUS;

/** Screens for holders of any of these permissions. Visitors sign in; others get the dashboard. */
export function requireAny(...permissions: string[]) {
    return defineServerMiddleware(async (c, next) => {
        const current = principal(c);
        if (permissions.some(permission => hasPermission(current, permission))) { await next(); return; }
        if (isTransportPath(c.req.path, 'rpc', 'upload', 'websocket')) {
            return c.json(current.kind === 'user' ? { error: 'Forbidden', code: 'COSSACK_RPC_FORBIDDEN' } : { error: 'Authentication required', code: 'COSSACK_RPC_UNAUTHENTICATED' }, current.kind === 'user' ? 403 : 401);
        }
        return c.redirect(current.kind === 'user' ? '/dashboard' : config('auth.redirectAfterLogout'));
    });
}
