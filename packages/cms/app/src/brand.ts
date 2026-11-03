/** The site's name and logo, from Settings → General, for the dashboard's sidebar and the sign-in pages. Replaces the scaffold's module. */
import { getRequestContext } from '@cossackframework/core';
import { MAIN_SITE } from '@cossackframework/cms';
import { currentCms, networkFor, siteUrl, type CmsBindings } from './cms/index';
import { pendingSite } from './cms/handoff';

export async function siteName(): Promise<string> {
    try { return await currentCms().settings.get('general.siteTitle'); }
    catch { return config('app.name'); }
}

/** The logo of Settings → General; the bundled one until it is set. */
export async function siteLogo(): Promise<string> {
    try { return await currentCms().settings.get('general.logo') || '/logo.svg'; }
    catch { return '/logo.svg'; }
}

/** Who the sign-in pages sign in to. */
export interface SignInBrand {
    name: string;
    logo: string;
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
    const own = async (networkSignIn: SignInBrand['networkSignIn'] = null) => ({ name: await siteName(), logo: await siteLogo(), home: '/', network: '', networkSignIn });
    const c = getRequestContext();
    if (!c) return own();
    try {
        const env = c.env as CmsBindings;
        const network = networkFor(env);
        if (c.get('site') && c.get('site').id !== MAIN_SITE) {
            return own(env.APP_URL ? { href: '/auth/handoff', name: (await network.settings()).name || await network.main.settings.get('general.siteTitle') } : null);
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
            home,
            network: (await network.settings()).name || await siteName(),
            networkSignIn: null,
        };
    } catch { return own(); }
}
