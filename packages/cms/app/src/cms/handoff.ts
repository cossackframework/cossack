import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { NETWORK_ADMIN } from '@cossackframework/cms';
import { MAIN_SITE, networkSite, type ChildSession, type CmsHost, type CmsNetwork, type NetworkSite } from '@cossackframework/cms/server';
import { authSessions, SESSION_COOKIE_NAME } from '../auth';
import { siteUrl, type CmsBindings } from './index';

/**
 * Sign-in for a network of sites. Accounts sign in only on the network host (the main site);
 * another site sends visitors there, and gets its own child session back through a one-use code:
 *
 * 1. `<site>/auth/login` → `<network>/auth/handoff?site=<id>&next=<path>`.
 * 2. Without a network session, the network keeps the request in a cookie and shows its sign-in;
 *    after any sign-in, the next page continues the handoff.
 * 3. With one, the network issues a code bound to the site and the session, valid for a minute,
 *    and sends the visitor to `<site>/auth/handoff?code=…`, which trades it for a child session.
 */
const HANDOFF_COOKIE = 'cms_handoff';
/** Sign-in pages that exist only on the network host. */
const NETWORK_PAGES = /^\/auth\/(?:login|register|forgot-password|reset-password|two-factor)(?:\/|$)/;

/** A path on the same site to go to afterwards; anything else is the dashboard. */
function nextPath(value: string | null | undefined): string {
    return value && /^\/(?!\/)[^\s\\]*$/.test(value) ? value : '/dashboard';
}

function secure(c: Context): boolean {
    return new URL(c.req.url).protocol === 'https:';
}

/**
 * Handoff routes and redirects, before auth runs. Null lets the request through. Without
 * APP_URL there is no network host to send sign-ins to, and each site signs in on its own host.
 */
export async function handoff(c: Context, network: CmsNetwork, site: NetworkSite): Promise<Response | null> {
    const env = c.env as CmsBindings;
    const url = new URL(c.req.url);
    if (site.id !== MAIN_SITE) {
        if (url.pathname === '/auth/handoff') return toSite(c, network, site);
        if (!env.APP_URL || !NETWORK_PAGES.test(url.pathname)) return null;
        const login = /^\/auth\/(?:login|register)(?:\/|$)/.test(url.pathname);
        const target = new URL(login ? '/auth/handoff' : `${url.pathname}${url.search}`, env.APP_URL);
        if (login) {
            target.searchParams.set('site', site.id);
            target.searchParams.set('next', nextPath(url.searchParams.get('next')));
            if (url.pathname.startsWith('/auth/register')) target.searchParams.set('register', '1');
        }
        return c.redirect(target.toString());
    }
    if (url.pathname === '/auth/handoff') return fromNetwork(c, network);
    // After signing in on the network host, continue the handoff the visitor came for.
    const pending = getCookie(c, HANDOFF_COOKIE);
    if (pending && !url.pathname.startsWith('/auth/') && !url.pathname.startsWith('/api/') && await networkSession(c, network)) {
        deleteCookie(c, HANDOFF_COOKIE, { path: '/' });
        const { site: id, next } = parsePending(pending);
        if (id) return c.redirect(`/auth/handoff?site=${encodeURIComponent(id)}&next=${encodeURIComponent(next)}`);
    }
    return null;
}

/** On the network host: issue a code for the site, or sign in first. */
async function fromNetwork(c: Context, network: CmsNetwork): Promise<Response> {
    const url = new URL(c.req.url);
    const id = url.searchParams.get('site') ?? '';
    const next = nextPath(url.searchParams.get('next'));
    const record = await network.sites.get(id);
    if (!record || (record.status !== 'active' && record.status !== 'archived')) return c.text('No site at this address.', 404);
    const session = await networkSession(c, network);
    if (!session) {
        setCookie(c, HANDOFF_COOKIE, JSON.stringify({ site: id, next }), { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 600, secure: secure(c) });
        return c.redirect(url.searchParams.get('register') === '1' ? '/auth/register' : '/auth/login');
    }
    deleteCookie(c, HANDOFF_COOKIE, { path: '/' });
    const site = networkSite(record);
    const account = await network.main.accounts.get(session.userId);
    if (!account || account.status !== 'active') return c.redirect('/auth/login');
    if (account.networkRole !== NETWORK_ADMIN && !(await network.hostOf(site).users.get(account.id))) {
        return c.text(`Your account is not a member of ${record.name}. Ask its administrator to add you.`, 403);
    }
    const code = await network.handoffs.issue({ session: session.reference, user: account.id, site: site.id });
    const target = new URL('/auth/handoff', siteUrl(c.env as CmsBindings, site));
    target.searchParams.set('code', code);
    target.searchParams.set('next', next);
    return c.redirect(target.toString());
}

/** On a site: trade the code for a child session in the site's own database. */
async function toSite(c: Context, network: CmsNetwork, site: NetworkSite): Promise<Response> {
    const url = new URL(c.req.url);
    const handoff = await network.handoffs.consume(url.searchParams.get('code') ?? '', site.id);
    if (!handoff) return c.html('<p>This sign-in link expired or was used. <a href="/auth/login">Sign in again</a>.</p>', 400);
    const cms = network.hostOf(site);
    // A network admin may open any site; the first visit copies them in without a role, so their writes have an author.
    if (handoff.networkRole === NETWORK_ADMIN) await cms.users.addMember(handoff.user);
    if (!(await cms.users.get(handoff.user))) return c.text('Your account is not a member of this site.', 403);
    c.set('cms.child', { parentId: handoff.session, networkRole: handoff.networkRole, expiresAt: handoff.expiresAt });
    const { headers } = await authSessions.create(handoff.user, c);
    headers.forEach((value, name) => c.header(name, value, { append: true }));
    return c.redirect(nextPath(url.searchParams.get('next')));
}

/** On the network host, the site a visitor is signing in to (active or archived), or null. */
export async function pendingSite(c: Context, network: CmsNetwork): Promise<NetworkSite | null> {
    const id = parsePending(getCookie(c, HANDOFF_COOKIE) ?? '').site;
    if (!id || c.get('site')?.id !== MAIN_SITE) return null;
    const record = await network.sites.get(id);
    return record && (record.status === 'active' || record.status === 'archived') ? networkSite(record) : null;
}

/** On the network host, the site a visitor is registering for, or null. */
export async function handoffSite(c: Context, network: CmsNetwork): Promise<CmsHost | null> {
    const id = parsePending(getCookie(c, HANDOFF_COOKIE) ?? '').site;
    if (!id || c.get('site')?.id !== MAIN_SITE) return null;
    const record = await network.sites.get(id);
    return record && record.status === 'active' ? network.hostOf(networkSite(record)) : null;
}

/** The visitor's live session on the network host, with its public reference. */
async function networkSession(c: Context, network: CmsNetwork): Promise<{ userId: string; reference: string } | null> {
    const id = getCookie(c, SESSION_COOKIE_NAME);
    if (!id) return null;
    const record = await authSessions.validate(id, c).catch(() => null);
    const reference = record ? await network.main.authSessions.publicReference(id) : null;
    return record && reference ? { userId: record.userId, reference } : null;
}

function parsePending(value: string): { site: string | null; next: string } {
    try {
        const parsed = JSON.parse(value) as { site?: unknown; next?: unknown };
        return { site: typeof parsed.site === 'string' && /^[a-z0-9-]{1,63}$/.test(parsed.site) ? parsed.site : null, next: nextPath(typeof parsed.next === 'string' ? parsed.next : null) };
    } catch { return { site: null, next: '/dashboard' }; }
}

declare module 'hono' {
    interface ContextVariableMap {
        /** A handoff in progress: the next session created on this request is a child session. */
        'cms.child': ChildSession;
        /** The network role a child session copied at its handoff. */
        'cms.networkRole': string | null;
    }
}
