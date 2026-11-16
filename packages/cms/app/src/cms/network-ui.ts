/**
 * The network pages' server helpers. They reach the CMS host through `./index`, which the client
 * gets as stubs: call them from `init()` and `post()`, never from `render()` or `@Page` options.
 * The guard is `requireNetworkAdmin` in `./guards`; render helpers are in `./network-view`.
 */
import type { Context } from 'hono';
import { MAIN_SITE, type CmsHost, type CmsNetwork, type NetworkSite } from '@cossackframework/cms/server';
import { networkFor, siteUrl, type CmsBindings } from './index';

export function network(c: Context): CmsNetwork {
    return networkFor(c.env as CmsBindings);
}

/** Site names by ID: the main site's title, and each added site's registry name. */
export async function siteNames(c: Context, ids: Iterable<string>): Promise<Map<string, string>> {
    const net = network(c);
    const names = new Map<string, string>();
    for (const id of new Set(ids)) {
        names.set(id, id === MAIN_SITE ? (await net.main.settings.get('general.siteTitle').catch(() => '')) || __('Main site') : (await net.sites.get(id))?.name ?? id);
    }
    return names;
}

/** A site's icon (Settings → General → Site icon) as a URL a page on another host can load; empty when it has none. */
export async function siteIconUrl(c: Context, host: CmsHost, site: Pick<NetworkSite, 'host'>): Promise<string> {
    const icon = await host.settings.get('general.favicon').catch(() => '');
    if (!icon || /^https?:\/\//.test(icon)) return icon;
    // A library file is served by its own site.
    return `${siteLinks(c, site).home.replace(/\/$/, '')}${icon}`;
}

/** A site's dashboard and home page. */
export function siteLinks(c: Context, site: Pick<NetworkSite, 'host'>): { home: string; dashboard: string } {
    const home = (siteUrl(c.env as CmsBindings, site) ?? '').replace(/\/$/, '');
    return { home: home || '/', dashboard: `${home}/dashboard` };
}
