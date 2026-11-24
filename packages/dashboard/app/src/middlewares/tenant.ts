import type { Context } from 'hono';
import { tenantORM } from '@/orm/factory';
import { defineServerMiddleware } from '@cossackframework/core';
import type { ORM } from '@cossackframework/database';
import { getCookie, deleteCookie, setCookie } from 'hono/cookie';
import { hostName, mainHost, markTenantRequest, sharedSignIn, tenantClaimingHost, tenantOfHost, tenantsEnabled, tenantsRunning, type TenantInfo } from '../tenants';
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
const TENANT_AUTO = 'tenant_auto';
const WELL_KNOWN = '/.well-known/cossack-tenant';
const TENANTS_SCREEN = /^\/dashboard\/tenants(?:\/|$)/;

export const tenantMiddleware = defineServerMiddleware(async (c, next) => {
    // The Tenants screen exists on the main host, while tenants are on.
    const screen = TENANTS_SCREEN.test(c.req.path);
    if (!tenantsEnabled) return screen ? c.notFound() : next();
    const main = mainHost();
    const host = hostName(c.req.url);
    if (!main || !host || host === main) {
        return sharedSignInOnMainHost(c) ?? next();
    }
    if (screen) return c.notFound();
    // A domain proves it points here by answering with the ID of the tenant that asked for it.
    if (c.req.path === WELL_KNOWN) {
        const claimed = await tenantClaimingHost(host);
        return claimed ? c.text(claimed) : c.notFound();
    }
    // While the network is off, only the main host answers.
    if (!await tenantsRunning()) return c.notFound();
    const tenant = await tenantOfHost(host, main);
    if (!tenant || tenant.status === 'creating' || tenant.status === 'deleted') return c.notFound();
    // The tenant's other hosts lead to its primary domain.
    if (tenant.primaryHost && host !== tenant.primaryHost && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
        const url = new URL(c.req.url);
        url.hostname = tenant.primaryHost;
        return c.redirect(url.toString(), 301);
    }
    if (tenant.status === 'archived') return c.text('This site is archived.', 503);
    // Shared sign-in. The tenant's sign-in page is for its own accounts; people with a main
    // account sign in on the main host, which sends them back with a one-time code. A visitor
    // goes there once on their own: signed in already, they arrive signed in; if not, they come
    // back to this page, whose link ("/auth/tenant/start") takes them to the main host's sign-in.
    const routed = sharedSignInOnTenantHost(c, host, main);
    if (routed) return routed;
    return inTenantDatabase(c, tenant, () => next());
});

/**
 * Shared sign-in, on the main host: a visitor a tenant's host sent here has signed in, and now
 * goes back with a code. Null when the request is not that.
 */
export function sharedSignInOnMainHost(c: Context): Response | null {
    const waiting = sharedSignIn && c.req.method === 'GET' && !c.req.path.startsWith('/auth/') ? getCookie(c, TENANT_RETURN) : undefined;
    if (!waiting || !getCookie(c, SESSION_COOKIE_NAME) || c.req.header('sec-fetch-dest') === 'empty') return null;
    deleteCookie(c, TENANT_RETURN, { path: '/' });
    return c.redirect(`/auth/tenant/redirect?${waiting}`);
}

/**
 * Shared sign-in, on a tenant's host. Its sign-in page is for its own accounts; people with a
 * main account sign in on the main host, which sends them back with a one-time code. A visitor
 * who opens the dashboard without a session here goes to the main host once on their own:
 * signed in there already, they arrive signed in; if not, they come back to the tenant's
 * sign-in page, whose link ("/auth/tenant/start") takes them to the main host's sign-in.
 * Null when the request is neither.
 */
export function sharedSignInOnTenantHost(c: Context, host: string, main: string): Response | null {
    const start = c.req.path === '/auth/tenant/start';
    const first = /^\/dashboard(?:\/|$)/.test(c.req.path) && !getCookie(c, TENANT_AUTO) && !getCookie(c, SESSION_COOKIE_NAME) && c.req.header('sec-fetch-dest') !== 'empty';
    if (!sharedSignIn || c.req.method !== 'GET' || !(start || first)) return null;
    const url = new URL(c.req.url);
    const secure = url.protocol === 'https:';
    const state = crypto.randomUUID().replaceAll('-', '');
    setCookie(c, TENANT_STATE, state, { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 600, secure });
    // Once in five minutes, so a visitor without a main session is not sent in circles.
    setCookie(c, TENANT_AUTO, '1', { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 300, secure });
    const back = returnPath(start ? c.req.query('next') : `${url.pathname}${url.search}`);
    const query = new URLSearchParams({ host, state, ...(back ? { next: back } : {}), ...(start ? {} : { auto: '1' }) });
    url.hostname = main;
    url.pathname = '/auth/tenant/redirect';
    url.search = query.toString();
    return c.redirect(url.toString());
}

/** Run the rest of the request in a tenant's database: models and services reach it, and the request knows its tenant. */
export async function inTenantDatabase<T>(c: Context, tenant: TenantInfo, work: () => Promise<T>): Promise<T> {
    const opened = await tenantORM(c.env, tenant);
    try {
        markTenantRequest(c, tenant, c.get('orm' as never) as ORM, opened.orm);
        return await opened.orm.run(work);
    } finally {
        // A response that streams keeps the database until its body ends.
        const lifetime = c.get('cossack:response-lifetime' as never) as { deferCleanup?(cleanup: () => Promise<void>): boolean } | undefined;
        if (!lifetime?.deferCleanup?.(() => opened.release())) await opened.release();
    }
}
