import { defineServerMiddleware } from '@cossackframework/core';
import { isTransportPath, transportAction, transportGuardPath, transportTargetPath } from '@cossackframework/core/transport-routes';
import { createAuthorizer } from '@cossackframework/auth';
import { auth, secondFactorRequired, setupRequired, type PublicUser } from '../auth';
import { authOptions } from '../auth-options';

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

/**
 * Whether a transport request runs the security page's own code under that page. A layout's
 * action runs under the page the browser names, so the guard path alone does not say whose
 * code runs: both paths must be the security page.
 */
function secondFactorSetupAction(c: { get: (key: any) => unknown }): boolean {
    return SECOND_FACTOR_SETUP.test(transportGuardPath(c) ?? '') && SECOND_FACTOR_SETUP.test(transportTargetPath(c) ?? '');
}

/** The dashboard layout's sign-out: staff who still have to add a second factor may always sign out. */
const DASHBOARD_LAYOUT = /\/pages\/dashboard\/layout\.[jt]s$/;
function signOutAction(c: { get: (key: any) => unknown }): boolean {
    return DASHBOARD_LAYOUT.test(transportTargetPath(c) ?? '') && transportAction(c) === 'doLogout';
}

// A layout guard also runs for the dashboard's RPC actions. The global path
// guard below sees /crpc rather than the component's dashboard URL, so the
// two-step requirement is enforced here too: until staff add a second factor,
// only the security page's own actions and the layout's sign-out answer.
export const requireDashboardUser = defineServerMiddleware(async (c, next) => {
    const user = c.get('user') as PublicUser | undefined;
    if (user && isTransportPath(c.req.path, 'rpc', 'upload', 'sse', 'websocket')
        && !secondFactorSetupAction(c) && !signOutAction(c)
        && await secondFactorRequired(user, c).catch(() => true)) {
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
 * The OAuth routes (/auth/<provider>/redirect and /callback) are exempt from the
 * guest check: a signed-in user would otherwise be bounced away mid-flow. So is the
 * CMS network's /auth/register-site, where a signed-in person registers a site for
 * their own account.
 *
 * A page of something the project turned off (src/dashboard.config.ts) answers 404:
 * the password pages without `credentials`, a dashboard module that is not chosen,
 * the whole dashboard when the project has none.
 */
const PASSWORD_PAGES = /^\/auth\/(?:register|forgot-password|reset-password|two-factor)(?:\/|$)/;
const OAUTH_ROUTE = /^\/auth\/[^/]+\/(?:redirect|callback)$/;
/** Sign-in pages that also serve people who are signed in. */
const SIGNED_IN_PAGES = /^\/auth\/register-site\/?$/;
/** The dashboard pages of each module. */
const MODULE_PAGES: Record<string, RegExp> = {
    users: /^\/dashboard\/users(?:\/|$)/,
    roles: /^\/dashboard\/roles(?:\/|$)/,
    sessions: /^\/dashboard\/sessions(?:\/|$)/,
    settings: /^\/dashboard\/profile(?:\/|$)/,
};

function turnedOff(path: string): boolean {
    if (PASSWORD_PAGES.test(path)) return !authOptions.authMethods.includes('credentials');
    if (!path.startsWith('/dashboard')) return false;
    if (!authOptions.dashboard) return true;
    return Object.entries(MODULE_PAGES).some(([module, pages]) => pages.test(path) && !(authOptions.modules as readonly string[]).includes(module));
}

export const authGuard = defineServerMiddleware(async (c, next) => {
    const { path } = c.req;
    const user = c.get('user');

    if (turnedOff(path)) return c.notFound();
    if (path.startsWith('/auth/') && user && !OAUTH_ROUTE.test(path) && !SIGNED_IN_PAGES.test(path)) {
        return c.redirect(config('auth.redirectAfterLogin'));
    }
    // A fresh site creates its first administrator on the setup page.
    if (path === '/auth/login' && c.req.method === 'GET' && await setupRequired()) {
        return c.redirect('/auth/setup');
    }
    if (path.startsWith('/dashboard') && !user) {
        return c.redirect(config('auth.redirectAfterLogout'));
    }
    // When General settings require two-step sign-in, staff without it set it up first. That
    // covers a page's form handlers too (POST, PUT, PATCH, DELETE), which answer at the page's URL.
    if (path.startsWith('/dashboard') && !path.startsWith('/dashboard/profile/security')) {
        const reading = c.req.method === 'GET' || c.req.method === 'HEAD';
        if (await secondFactorRequired(user as PublicUser, c).catch(() => !reading)) {
            return c.redirect('/dashboard/profile/security?required=1', reading ? 302 : 303);
        }
    }
    await next();
});

/** The middleware of sign-in, in order, for src/bootstrap/middlewares.ts: the session, then the guard. */
export const authMiddlewares = [auth.middleware, authGuard];
