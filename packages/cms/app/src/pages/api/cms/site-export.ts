import type { Context } from 'hono';
import { hasPermission, holdsAll, isNetworkAdmin, MAIN_SITE, PERMISSIONS } from '@cossackframework/cms';
import { exportResponse, fileExportResponse } from '../../../cms/site-export';

/**
 * This site's database as a JSON file, `GET /api/cms/site-export`, for its admins signed in
 * with a session: at once on the main site or when the network lets sites export themselves,
 * otherwise for 7 days after a network admin approves the site's request (Tools → Export).
 * `?format=romedb` downloads the database as a `.romedb` file. It holds the accounts' password
 * hashes, so it is for those who may manage every account in it: network admins for the main
 * site's (every network account), and on an added site user managers who hold every permission
 * any of its roles gives, as changing any one of those accounts asks.
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
        const roles = await cms.users.roles();
        if (!isNetworkAdmin(principal) && (!hasPermission(principal, PERMISSIONS.manageUsers) || !holdsAll(principal, roles.flatMap(role => role.permissions)))) {
            return c.json({ error: 'The database file holds every account\'s password: only an administrator who may manage all of them downloads it.', code: 'CMS_FORBIDDEN' }, 403);
        }
        return fileExportResponse(cms, site, c.req.raw.signal);
    }
    const title = await cms.settings.get('general.siteTitle').catch(() => '');
    return exportResponse(cms, site, site.id === MAIN_SITE ? title : site.name ?? title);
};
