import { defineServerMiddleware } from '@cossackframework/core';
import { isTransportPath } from '@cossackframework/core/transport-routes';
import { createAuthorizer } from '@cossackframework/auth';
import { auth } from '../auth';

const dashboardAuthorizer = createAuthorizer({
    onUnauthorized: (c, reason) => {
        if (isTransportPath(c.req.path, 'rpc', 'upload', 'websocket')) {
            return c.json({ error: reason === 'unauthenticated' ? 'Authentication required' : 'Forbidden',
                code: reason === 'unauthenticated' ? 'COSSACK_RPC_UNAUTHENTICATED' : 'COSSACK_RPC_FORBIDDEN' },
                reason === 'unauthenticated' ? 401 : 403);
        }
        return c.redirect(config('auth.redirectAfterLogout'));
    },
});

// A layout guard also runs for the dashboard's RPC actions. The global path
// guard below sees /crpc rather than the component's dashboard URL.
export const requireDashboardUser = defineServerMiddleware(dashboardAuthorizer.requireUser);

/**
 * Auth guard.
 *
 * `auth.middleware` (registered in src/bootstrap/middlewares.ts) populates
 * `c.get('user')` for every request. This guard enforces two prefix-based
 * rules using the global `config()` helper (backed by src/config/auth.ts):
 *
 *   - Guest-only: logged-in users visiting /auth/* are redirected to
 *     `config('auth.redirectAfterLogin')` (default /dashboard), so they can't
 *     see login/register once signed in.
 *   - Private: logged-out users visiting /dashboard are redirected to
 *     `config('auth.redirectAfterLogout')` (default /auth/login).
 *
 * Everything else (including framework endpoints like /crpc and /upload, and
 * static assets) is reachable without a session.
 *
 * NOTE: if you mount OAuth callback routes (e.g. /auth/<provider>/callback),
 * exempt them from the guest check below — a logged-in user would otherwise be
 * bounced away mid-flow.
 */
export const authGuard = defineServerMiddleware(async (c, next) => {
    const { path } = c.req;
    const user = c.get('user');

    if (path.startsWith('/auth/') && user) {
        return c.redirect(config('auth.redirectAfterLogin'));
    }
    if (path.startsWith('/dashboard') && !user) {
        return c.redirect(config('auth.redirectAfterLogout'));
    }
    await next();
});
