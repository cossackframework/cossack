import { defineServerMiddleware } from '@cossackframework/core';
import { isTransportPath, transportGuardPath } from '@cossackframework/core/transport-routes';
import { createAuthorizer } from '@cossackframework/auth';
import { auth, secondFactorRequired, setupRequired, type PublicUser } from '../auth';

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

/** The page where staff add the second factor that General settings require. */
const SECOND_FACTOR_SETUP = /\/pages\/dashboard\/profile\/security\/index\.[jt]s$/;

// A layout guard also runs for the dashboard's RPC actions. The global path
// guard below sees /crpc rather than the component's dashboard URL, so the
// two-step requirement is enforced here too: until staff add a second factor,
// only the security page's actions answer.
export const requireDashboardUser = defineServerMiddleware(async (c, next) => {
    const user = c.get('user') as PublicUser | undefined;
    if (user && isTransportPath(c.req.path, 'rpc', 'upload', 'sse', 'websocket')
        && !SECOND_FACTOR_SETUP.test(transportGuardPath(c) ?? '')
        && await secondFactorRequired(user).catch(() => true)) {
        return c.json({ error: 'This site requires two-step sign-in: set it up under Profile → Security first.', code: 'COSSACK_RPC_FORBIDDEN' }, 403);
    }
    return dashboardAuthorizer.requireUser(c, next);
});

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
    // A fresh site creates its first administrator on the setup page.
    if (path === '/auth/login' && c.req.method === 'GET' && await setupRequired()) {
        return c.redirect('/auth/setup');
    }
    if (path.startsWith('/dashboard') && !user) {
        return c.redirect(config('auth.redirectAfterLogout'));
    }
    // When General settings require two-step sign-in, staff without it set it up first.
    if (path.startsWith('/dashboard') && !path.startsWith('/dashboard/profile/security') && c.req.method === 'GET'
        && await secondFactorRequired(user as PublicUser).catch(() => false)) {
        return c.redirect('/dashboard/profile/security?required=1');
    }
    await next();
});
