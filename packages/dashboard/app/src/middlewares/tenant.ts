import { tenantORM } from '@/orm/factory';
import { defineServerMiddleware } from '@cossackframework/core';
import type { ORM } from '@cossackframework/database';
import { getCookie, deleteCookie, setCookie } from 'hono/cookie';
import { hostName, mainHost, markTenantRequest, sharedSignIn, tenantOfHost, tenantsEnabled } from '../tenants';
import { returnPath } from '../auth-input';
import { SESSION_COOKIE_NAME } from '../auth';

/**
 * With tenants on: find the tenant of the request's host and run the request in that tenant's
 * database. It goes after the ORM middleware (which opened the main database's scope) and
 * before the session, so sign-in sees which tenant the request is for.
 *
 * The main host, and every host while APP_URL is not set, is the main tenant: nothing changes.
 * An unknown host answers 404, an archived tenant 503.
 */
// The cookies of shared sign-in; the endpoints under src/pages/auth/tenant read them.
const TENANT_STATE = 'tenant_state';
const TENANT_RETURN = 'tenant_return';
const TENANTS_SCREEN = /^\/dashboard\/tenants(?:\/|$)/;

export const tenantMiddleware = defineServerMiddleware(async (c, next) => {
    // The Tenants screen exists on the main host, while tenants are on.
    const screen = TENANTS_SCREEN.test(c.req.path);
    if (!tenantsEnabled) return screen ? c.notFound() : next();
    const main = mainHost();
    const host = hostName(c.req.url);
    if (!main || !host || host === main) {
        // Shared sign-in: a visitor a tenant's host sent here signed in, and now goes back with a code.
        const waiting = sharedSignIn && c.req.method === 'GET' && !c.req.path.startsWith('/auth/') ? getCookie(c, TENANT_RETURN) : undefined;
        if (waiting && getCookie(c, SESSION_COOKIE_NAME) && c.req.header('sec-fetch-dest') !== 'empty') {
            deleteCookie(c, TENANT_RETURN, { path: '/' });
            return c.redirect(`/auth/tenant/redirect?${waiting}`);
        }
        return next();
    }
    if (screen) return c.notFound();
    const tenant = await tenantOfHost(host, main);
    if (!tenant || tenant.status === 'creating') return c.notFound();
    if (tenant.status === 'archived') return c.text('This site is archived.', 503);
    // Shared sign-in: people sign in on the main host, which sends them back with a one-time code.
    if (sharedSignIn && c.req.method === 'GET' && c.req.path === '/auth/login') {
        const url = new URL(c.req.url);
        const state = crypto.randomUUID().replaceAll('-', '');
        setCookie(c, TENANT_STATE, state, { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 600, secure: url.protocol === 'https:' });
        const back = returnPath(c.req.query('redirect'));
        const query = new URLSearchParams({ host, state, ...(back ? { next: back } : {}) });
        url.hostname = main;
        url.pathname = '/auth/tenant/redirect';
        url.search = query.toString();
        return c.redirect(url.toString());
    }
    const opened = await tenantORM(c.env, tenant);
    try {
        markTenantRequest(c, tenant, c.get('orm' as never) as ORM, opened.orm);
        await opened.orm.run(() => next());
    } finally {
        // A response that streams keeps the database until its body ends.
        const lifetime = c.get('cossack:response-lifetime' as never) as { deferCleanup?(cleanup: () => Promise<void>): boolean } | undefined;
        if (!lifetime?.deferCleanup?.(() => opened.release())) await opened.release();
    }
});
