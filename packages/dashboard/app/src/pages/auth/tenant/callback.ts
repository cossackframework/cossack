import type { Context } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { completeTenantHandoff, sharedSignInAvailable } from '#app/auth';
import { returnPath } from '#app/auth-input';

/** The value a tenant's host gave the visitor before sending them to the main host. */
const TENANT_STATE_COOKIE = 'tenant_state';

/**
 * Shared sign-in, on a tenant's host: the main host sent the visitor back with a one-time
 * code. The code counts only in the browser that started here (the state cookie), so nobody
 * can be signed in to someone else's account by a link.
 */
export const GET = async (c: Context) => {
    if (!sharedSignInAvailable) return c.notFound();
    const state = c.req.query('state') ?? '';
    const expected = getCookie(c, TENANT_STATE_COOKIE) ?? '';
    deleteCookie(c, TENANT_STATE_COOKIE, { path: '/' });
    const headers = state && state === expected ? await completeTenantHandoff(c, c.req.query('code') ?? '') : null;
    if (!headers) return c.text('This sign-in did not complete. Open the site again to retry.', 400);
    headers.forEach((value, key) => c.header(key, value, { append: true }));
    return c.redirect(returnPath(c.req.query('next')) ?? config('auth.redirectAfterLogin'));
};
