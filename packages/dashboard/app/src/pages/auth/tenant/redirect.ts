import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { issueTenantHandoff, sharedSignInAvailable, tenantHandoffTarget, tenantSignInUrl, type PublicUser } from '#app/auth';
import { returnPath } from '#app/auth-input';

/** Where a visitor who still has to sign in was going: kept on the main host for ten minutes. */
const TENANT_RETURN_COOKIE = 'tenant_return';

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** A form of this host's own page sent the request: another site cannot press Continue for the visitor. */
function ownForm(c: Context): boolean {
    const site = c.req.header('sec-fetch-site')?.toLowerCase();
    if (site === 'same-origin') return true;
    if (site !== undefined) return false;
    const origin = c.req.header('origin');
    const url = new URL(c.req.url);
    return origin === url.origin || (c.req.header('x-forwarded-proto')?.toLowerCase() === 'https' && origin === `https://${url.host}`);
}

/**
 * A tenant's own domain is run by the tenant: a code sent there can be read there. So the
 * visitor says yes on the main host first, and sees which account and which site it is for.
 */
function confirmation(c: Context, target: { name: string; host: string }, user: PublicUser, fields: Record<string, string>): Response {
    const inputs = Object.entries(fields).map(([name, value]) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`).join('');
    return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Sign in to ${escape(target.name)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f6f7;color:#18181b}main{max-width:26rem;margin:1rem;padding:1.5rem;background:#fff;border:1px solid #e4e4e7;border-radius:.5rem}h1{font-size:1.25rem;margin:0 0 .75rem}p{margin:0 0 1rem}button{font:inherit;padding:.5rem 1rem;border-radius:.375rem;border:1px solid #18181b;background:#18181b;color:#fff;cursor:pointer}a{margin-left:.75rem;color:inherit}@media (prefers-color-scheme:dark){body{background:#09090b;color:#fafafa}main{background:#18181b;border-color:#27272a}button{background:#fafafa;color:#18181b;border-color:#fafafa}}</style></head>
<body><main><h1>Sign in to ${escape(target.name)}?</h1>
<p>You are about to sign in to <strong>${escape(target.name)}</strong> at <strong>${escape(target.host)}</strong> as <strong>${escape(user.email)}</strong>.</p>
<p>Continue only if you opened this site yourself.</p>
<form method="post" action="/auth/tenant/redirect">${inputs}<button type="submit">Continue</button><a href="/dashboard">Cancel</a></form></main></body></html>`);
}

async function handoff(c: Context, host: string, state: string, next: string | null, auto: boolean): Promise<Response> {
    const issued = await issueTenantHandoff(c, host, state, next);
    if ('error' in issued) {
        const back = auto ? await tenantSignInUrl(c, host) : null;
        return back ? c.redirect(back) : c.text(issued.error, issued.status);
    }
    return c.redirect(issued.url);
}

/**
 * Shared sign-in, on the main host: a tenant's host sent the visitor here. A signed-in member
 * goes back with a one-time code; anyone else signs in first and is brought back here. With
 * `auto=1` the tenant's host sent the visitor on its own, and nobody is asked to sign in.
 * For a tenant's own domain the visitor confirms first (`POST`), and is never sent on their own.
 */
export const GET = async (c: Context) => {
    if (!sharedSignInAvailable) return c.notFound();
    const host = c.req.query('host') ?? '';
    const state = c.req.query('state') ?? '';
    const next = returnPath(c.req.query('next'));
    // The visitor did not ask to come: without a session here, or without a place in the tenant,
    // they go back to the tenant's own sign-in page.
    const auto = c.req.query('auto') === '1';
    const user = c.get('user') as PublicUser | undefined;
    if (auto && !user) {
        const back = await tenantSignInUrl(c, host);
        return back ? c.redirect(back) : c.notFound();
    }
    if (!user) {
        const secure = new URL(c.req.url).protocol === 'https:';
        setCookie(c, TENANT_RETURN_COOKIE, new URLSearchParams({ host, state, ...(next ? { next } : {}) }).toString(), { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 600, secure });
        return c.redirect('/auth/login');
    }
    const target = await tenantHandoffTarget(host);
    if (target?.custom) {
        // Nobody is signed in to a tenant's own domain without asking for it.
        if (auto) {
            const back = await tenantSignInUrl(c, host);
            return back ? c.redirect(back) : c.notFound();
        }
        return confirmation(c, target, user, { host, state, ...(next ? { next } : {}) });
    }
    return handoff(c, host, state, next, auto);
};

/** The visitor pressed Continue on this host's confirmation page. */
export const POST = async (c: Context) => {
    if (!sharedSignInAvailable) return c.notFound();
    if (!ownForm(c)) return c.text('Forbidden', 403);
    // Only a signed-in visitor saw the page whose form this is.
    if (!c.get('user')) return c.text('Sign in first.', 401);
    let form: FormData;
    try { form = await c.req.formData(); }
    catch { return c.text('The request is not complete.', 400); }
    const value = (name: string) => String(form.get(name) ?? '');
    return handoff(c, value('host'), value('state'), returnPath(value('next') || undefined), false);
};
