/** The site's name and logo, from Settings → General, for the dashboard's sidebar and the sign-in pages. Replaces the scaffold's module. */
import { getRequestContext } from '@cossackframework/core';
import { MAIN_SITE } from '@cossackframework/cms';
import { currentCms, networkFor, siteUrl, type CmsBindings } from './cms/index';
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { CmsNetwork, NetworkSite } from '@cossackframework/cms/server';

export async function siteName(): Promise<string> {
    try { return await currentCms().settings.get('general.siteTitle'); }
    catch { return config('app.name'); }
}

/** The logo of Settings → General; the bundled one until it is set. */
export async function siteLogo(): Promise<string> {
    try { return await currentCms().settings.get('general.logo') || '/logo.svg'; }
    catch { return '/logo.svg'; }
}

/** Whether Settings → General has a logo: it then stands for the site alone, without the name beside it. */
export async function siteHasLogo(): Promise<boolean> {
    try { return Boolean(await currentCms().settings.get('general.logo')); }
    catch { return false; }
}

/** Who the sign-in pages sign in to. */
export interface SignInBrand {
    name: string;
    logo: string;
    /** The site set its own logo: the pages show it without the name. */
    logoOnly: boolean;
    /** Where "Back to Home" goes. */
    home: string;
    /** The network whose account signs the visitor in to another site; empty otherwise. */
    network: string;
    /** On a site of a network: where its members with a network account sign in instead, and the network's name. */
    networkSignIn: { href: string; name: string } | null;
}

/**
 * The sign-in pages' brand: this site's, or on the network host, the site the visitor came
 * from to sign in, with its own address and logo. An added site's pages sign in its own
 * accounts and link the network's sign-in for network accounts.
 */
export async function signInBrand(): Promise<SignInBrand> {
    const own = async (networkSignIn: SignInBrand['networkSignIn'] = null) => ({ name: await siteName(), logo: await siteLogo(), logoOnly: await siteHasLogo(), home: '/', network: '', networkSignIn });
    const c = getRequestContext();
    if (!c) return own();
    try {
        const env = c.env as CmsBindings;
        const network = networkFor(env);
        if (c.get('site') && c.get('site').id !== MAIN_SITE) {
            return own(env.APP_URL ? { href: '/auth/tenant/start', name: (await network.settings()).name || await network.main.settings.get('general.siteTitle') } : null);
        }
        const site = await pendingSite(c, network);
        if (!site) return own();
        const settings = network.hostOf(site).settings;
        const home = siteUrl(env, site) ?? '/';
        const logo = await settings.get('general.logo');
        return {
            name: await settings.get('general.siteTitle') || site.name || home,
            // A site's media is served on its own host.
            logo: logo ? new URL(logo, home).toString() : '/logo.svg',
            logoOnly: Boolean(logo),
            home,
            network: (await network.settings()).name || await siteName(),
            networkSignIn: null,
        };
    } catch { return own(); }
}

/**
 * On the network host: the site that sent the visitor here to sign in (shared sign-in keeps
 * its address in the `tenant_return` cookie until they are signed in), or null.
 */
async function pendingSite(c: Context, network: CmsNetwork): Promise<NetworkSite | null> {
    const host = new URLSearchParams(getCookie(c, 'tenant_return') ?? '').get('host');
    if (!host) return null;
    const found = await network.resolve(host).catch(() => null);
    return found?.kind === 'site' && found.site.id !== MAIN_SITE ? found.site : null;
}

/** What the network host is called on a site's pages: the network's name, or the main site's title. */
export async function mainSiteName(): Promise<string> {
    const c = getRequestContext();
    try {
        const network = networkFor(c!.env as CmsBindings);
        return (await network.settings()).name || await network.main.settings.get('general.siteTitle') || 'the network';
    } catch { return 'the network'; }
}
