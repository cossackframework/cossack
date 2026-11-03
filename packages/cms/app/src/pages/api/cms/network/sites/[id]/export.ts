import type { Context } from 'hono';
import { isNetworkAdmin, MAIN_SITE } from '@cossackframework/cms';
import { networkSite } from '@cossackframework/cms/server';
import { exportResponse } from '../../../../../../cms/site-export';

/** A site's database as a JSON file for network admins, on the network host: `GET /api/cms/network/sites/<id>/export`. */
export const GET = async (c: Context) => {
    if (!isNetworkAdmin(c.get('principal')) || c.get('site')?.id !== MAIN_SITE || c.get('cms.token')) return c.json({ error: 'Only network admins export sites, signed in on the network host.', code: 'CMS_FORBIDDEN' }, 403);
    const network = c.get('network');
    const record = await network.sites.get(c.req.param('id') ?? '');
    if (!record || record.status === 'creating') return c.json({ error: 'There is no such site.', code: 'CMS_NOT_FOUND' }, 404);
    const site = networkSite(record);
    return exportResponse(network.hostOf(site), site, record.name);
};
