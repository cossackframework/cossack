// Registering a site from the network host's sign-up page, when the network lets people
// register sites (Settings → Network). The account that registers it is its administrator.
import { ClientVisibleError, getClientIp, getRequestContext } from '@cossackframework/core';
import { isCmsError, userPrincipal } from '@cossackframework/cms';
import type { SiteRegistration } from '@cossackframework/cms/server';
import { loginUser } from '#app/auth';
import { mailer } from '#app/mail';
import { currentCms, networkFor, type CmsBindings } from './index';
import { networkAccounts } from './network-accounts';

/** Registrations one address sends in an hour. */
const SITE_REGISTRATION_REQUESTS = Object.freeze({ perAddress: 10, windowMs: 60 * 60_000 });

/** Whether this request is on the network host of a network that lets people register sites. */
export async function siteRegistrationOpen(): Promise<boolean> {
    const c = getRequestContext();
    if (!c) return false;
    const network = networkFor(c.env as CmsBindings);
    if (currentCms() !== network.main || !network.canAddSites) return false;
    try { return (await network.settings()).siteRegistration && await network.enabled(); }
    catch { return false; }
}

/** A refusal of the network as text the page shows. */
async function siteError<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); }
    catch (error) {
        if (isCmsError(error)) throw new ClientVisibleError(error.message);
        throw error;
    }
}

/**
 * Register a site. A signed-in visitor (`userId`) gives the site alone. Otherwise the visitor
 * gives an email and a password: an existing account's, checked as a sign-in is, makes the site
 * at once; a new email gets a network account and the site, where the network cannot send a
 * confirmation link. Where it can, a new person makes an account first (Register), confirms
 * the email, and registers the site signed in.
 */
export async function registerSite(input: { site: SiteRegistration; name?: string; email?: string; password?: string }, userId: string | null): Promise<{ site: string; user: string; signIn: boolean }> {
    const c = getRequestContext();
    if (!c || !(await siteRegistrationOpen())) throw new ClientVisibleError('Site registration is closed on this network.');
    const network = networkFor(c.env as CmsBindings);
    if (!(await network.main.attempts.attempt('site-registration', `address:${getClientIp(c) || 'unknown'}`, SITE_REGISTRATION_REQUESTS.perAddress, SITE_REGISTRATION_REQUESTS.windowMs))) {
        throw new ClientVisibleError('Too many sites were registered from here. Try again in an hour.');
    }
    const site = await siteError(() => network.checkSiteRegistration(input.site));
    const create = async (accountId: string) => (await siteError(() => network.registerSite(site, { principal: userPrincipal(accountId, [], []) }))).id;
    if (userId) return { site: await create(userId), user: userId, signIn: false };
    const email = String(input.email ?? '').trim().toLowerCase();
    const password = String(input.password ?? '');
    if (await networkAccounts.findByEmail(email)) {
        // An account's own password makes its site, counted as a sign-in attempt.
        const account = await loginUser(email, password);
        if (!account) throw new ClientVisibleError('An account with this email exists. Enter its password, or sign in first.');
        return { site: await create(account.id), user: account.id, signIn: true };
    }
    if (mailer()) throw new ClientVisibleError('Create your account first (Register), confirm your email, then register your site.');
    const account = await networkAccounts.create({ email, password, name: input.name?.trim() || email.split('@')[0]! });
    return { site: await create(account.id), user: account.id, signIn: true };
}
