import type { Context } from 'hono';
import { hasPermission, isNetworkAdmin, MAIN_SITE, PERMISSIONS } from '@cossackframework/cms';
import { exportResponse, fileExportResponse } from '../../../cms/site-export';

/**
 * This site's database as a JSON file, `GET /api/cms/site-export`, for its admins signed in
 * with a session: at once on the main site or when the network lets sites export themselves,
 * otherwise for 7 days after a network admin approves the site's request (Tools → Export).
 * `?format=romedb` downloads the database as a `.romedb` file. The main site's holds every
 * network account with its password hash, so that one is for network admins.
 */
export const GET = async (c: Context) => {
    const principal = c.get('principal');
    if (principal.kind !== 'user' || c.get('cms.token')) return c.json({ error: 'Sign in to export the site.', code: 'CMS_UNAUTHENTICATED' }, 401);
    if (!hasPermission(principal, PERMISSIONS.manageSettings)) return c.json({ error: 'Only the site\'s admins export it.', code: 'CMS_FORBIDDEN' }, 403);
    const site = c.get('site');
    if (!(await c.get('network').exportAccess(site.id)).allowed) return c.json({ error: 'A network admin approves this site\'s export first: request it under Tools → Export.', code: 'CMS_FORBIDDEN' }, 403);
    const cms = c.get('cms');
    if (c.req.query('format') === 'romedb') {
        if (site.id === MAIN_SITE && !isNetworkAdmin(principal)) return c.json({ error: 'Only network admins download the main site\'s database file.', code: 'CMS_FORBIDDEN' }, 403);
        return fileExportResponse(cms, site, c.req.raw.signal);
    }
    const title = await cms.settings.get('general.siteTitle').catch(() => '');
    return exportResponse(cms, site, site.id === MAIN_SITE ? title : site.name ?? title);
};
