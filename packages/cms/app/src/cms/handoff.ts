import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { NETWORK_ADMIN } from '@cossackframework/cms';
import { MAIN_SITE, networkSite, type ChildSession, type CmsHost, type CmsNetwork, type NetworkSite } from '@cossackframework/cms/server';
import { authSessions, SESSION_COOKIE_NAME } from '../auth';
import { siteUrl, type CmsBindings } from './index';

/**
 * Sign-in for a network of sites. An added site's own sign-in pages sign in its site accounts.
 * Network accounts sign in only on the network host (the main site), and the site gets its own
 * child session back through a one-use code:
 *
 * 1. `<site>/auth/handoff?next=<path>` (the sign-in pages' network link) →
 *    `<network>/auth/handoff?site=<id>&next=<path>`.
 * 2. Without a network session, the network keeps the request in a cookie and shows its sign-in;
 *    after any sign-in, the next page continues the handoff.
 * 3. With one, the network issues a code bound to the site and the session, valid for a minute,
 *    and sends the visitor to `<site>/auth/handoff?code=…`, which trades it for a child session.
 *
 * A visitor who opens a site's dashboard without a session there goes through the same steps on
 * their own, with `auto=1`: a network admin, or a member signed in on the network, arrives signed
 * in without a click; anyone else comes back to the site's own sign-in, and the attempt is not
 * repeated for a while (`cms_handoff_auto`), so a site account signs in there as before.
 */
const HANDOFF_COOKIE = 'cms_handoff';
/** Set by a site that started a handoff on its own: no second attempt until it expires. */
const AUTO_COOKIE = 'cms_handoff_auto';
/** The site paths a missing session starts a handoff for: the dashboard, which needs one. */
const AUTO_PATHS = /^\/dashboard(?:\/|$)/;

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
        if (url.pathname === '/auth/handoff') {
            if (url.searchParams.has('code')) return toSite(c, network, site);
            // Sign in with a network account: on the network host, which hands the session back.
            if (!env.APP_URL) return c.text('This network has no sign-in host: set APP_URL.', 404);
            return c.redirect(toNetwork(env.APP_URL, site, nextPath(url.searchParams.get('next')), url.searchParams.get('auto') === '1'));
        }
        // The dashboard without a live session here: the network may have one, so ask it once before the site's sign-in shows.
        if (env.APP_URL && c.req.method === 'GET' && AUTO_PATHS.test(url.pathname) && !getCookie(c, AUTO_COOKIE) && !(await siteSession(c))) {
            setCookie(c, AUTO_COOKIE, '1', { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 300, secure: secure(c) });
            return c.redirect(toNetwork(env.APP_URL, site, nextPath(url.pathname + url.search), true));
        }
        return null;
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

/** The network's handoff address for a site: where the site sends a visitor to sign in, or to try their network session (`auto`). */
function toNetwork(appUrl: string, site: Pick<NetworkSite, 'id'>, next: string, auto: boolean): string {
    const target = new URL('/auth/handoff', appUrl);
    target.searchParams.set('site', site.id);
    target.searchParams.set('next', next);
    if (auto) target.searchParams.set('auto', '1');
    return target.toString();
}

/** Whether the request carries a live session of this site. */
async function siteSession(c: Context): Promise<boolean> {
    const id = getCookie(c, SESSION_COOKIE_NAME);
    return !!id && !!(await authSessions.validate(id, c).catch(() => null));
}

/**
 * On the network host: issue a code for the site, or sign in first. An attempt the site started
 * on its own (`auto`) never shows the network's sign-in: without a session, or for an account
 * that is not a member, the visitor goes back to the site's own sign-in.
 */
async function fromNetwork(c: Context, network: CmsNetwork): Promise<Response> {
    const env = c.env as CmsBindings;
    const url = new URL(c.req.url);
    const id = url.searchParams.get('site') ?? '';
    const next = nextPath(url.searchParams.get('next'));
    const auto = url.searchParams.get('auto') === '1';
    const record = await network.sites.get(id);
    if (!record || (record.status !== 'active' && record.status !== 'archived')) return c.text('No site at this address.', 404);
    const site = networkSite(record);
    const siteLogin = () => c.redirect(new URL('/auth/login', siteUrl(env, site)).toString());
    const session = await networkSession(c, network);
    if (!session) {
        if (auto) return siteLogin();
        setCookie(c, HANDOFF_COOKIE, JSON.stringify({ site: id, next }), { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 600, secure: secure(c) });
        return c.redirect(url.searchParams.get('register') === '1' ? '/auth/register' : '/auth/login');
    }
    deleteCookie(c, HANDOFF_COOKIE, { path: '/' });
    const account = await network.main.accounts.get(session.userId);
    if (!account || account.status !== 'active') return auto ? siteLogin() : c.redirect('/auth/login');
    if (account.networkRole !== NETWORK_ADMIN && !(await network.hostOf(site).users.get(account.id))) {
        if (auto) return siteLogin();
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
    deleteCookie(c, AUTO_COOKIE, { path: '/' });
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
