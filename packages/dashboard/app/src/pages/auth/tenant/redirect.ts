import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { issueTenantHandoff, sharedSignInAvailable, tenantSignInUrl } from '#app/auth';
import { returnPath } from '#app/auth-input';

/** Where a visitor who still has to sign in was going: kept on the main host for ten minutes. */
const TENANT_RETURN_COOKIE = 'tenant_return';

/**
 * Shared sign-in, on the main host: a tenant's host sent the visitor here. A signed-in member
 * goes back with a one-time code; anyone else signs in first and is brought back here. With
 * `auto=1` the tenant's host sent the visitor on its own, and nobody is asked to sign in.
 */
export const GET = async (c: Context) => {
    if (!sharedSignInAvailable) return c.notFound();
    const host = c.req.query('host') ?? '';
    const state = c.req.query('state') ?? '';
    const next = returnPath(c.req.query('next'));
    // The visitor did not ask to come: without a session here, or without a place in the tenant,
    // they go back to the tenant's own sign-in page.
    const auto = c.req.query('auto') === '1';
    if (auto && !c.get('user')) {
        const back = await tenantSignInUrl(c, host);
        return back ? c.redirect(back) : c.notFound();
    }
    if (!c.get('user')) {
        const secure = new URL(c.req.url).protocol === 'https:';
        setCookie(c, TENANT_RETURN_COOKIE, new URLSearchParams({ host, state, ...(next ? { next } : {}) }).toString(), { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 600, secure });
        return c.redirect('/auth/login');
    }
    const issued = await issueTenantHandoff(c, host, state, next);
    if ('error' in issued) {
        const back = auto ? await tenantSignInUrl(c, host) : null;
        return back ? c.redirect(back) : c.text(issued.error, issued.status);
    }
    return c.redirect(issued.url);
};
