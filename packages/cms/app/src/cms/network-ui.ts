/**
 * The network pages' server helpers. They reach the CMS host through `./index`, which the client
 * gets as stubs: call them from `init()` and `post()`, never from `render()` or `@Page` options.
 * The guard is `requireNetworkAdmin` in `./guards`; render helpers are in `./network-view`.
 */
import type { Context } from 'hono';
import type { CmsNetwork, NetworkSite } from '@cossackframework/cms/server';
import { networkFor, siteUrl, type CmsBindings } from './index';

export function network(c: Context): CmsNetwork {
    return networkFor(c.env as CmsBindings);
}

/** A site's dashboard and home page. */
export function siteLinks(c: Context, site: Pick<NetworkSite, 'host'>): { home: string; dashboard: string } {
    const home = (siteUrl(c.env as CmsBindings, site) ?? '').replace(/\/$/, '');
    return { home: home || '/', dashboard: `${home}/dashboard` };
}
