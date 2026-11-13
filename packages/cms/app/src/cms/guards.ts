import { defineServerMiddleware } from '@cossackframework/core';
import { isTransportPath } from '@cossackframework/core/transport-routes';
import { ANONYMOUS, hasPermission, isNetworkAdmin, MAIN_SITE, type Principal } from '@cossackframework/cms';
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

/** The network dashboard: network admins, on the network host, while the network is on. Others go to their dashboard. */
export function requireNetworkAdmin() {
    return defineServerMiddleware(async (c, next) => {
        if (isNetworkAdmin(principal(c)) && c.get('site')?.id === MAIN_SITE && await c.get('network')?.enabled()) { await next(); return; }
        if (isTransportPath(c.req.path, 'rpc', 'upload', 'websocket')) return c.json({ error: 'Forbidden', code: 'COSSACK_RPC_FORBIDDEN' }, 403);
        return c.redirect('/dashboard');
    });
}
