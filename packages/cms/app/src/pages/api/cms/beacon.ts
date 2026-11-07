import type { Context } from 'hono';
import { CmsTraffic } from '@cossackframework/cms/server';
import { getClientIp } from '@cossackframework/core';

/**
 * The site's beacon: `POST /api/cms/beacon` with `{ p: path, r: referrer }` from the page's
 * script. Counts a view of the path and a visitor of the day (a hash of address, browser and day;
 * nothing is stored that names the person), and the referring site. Crawlers, bad paths and a
 * beacon turned off in Settings → Analytics are ignored. Always 204.
 */
export const POST = async (c: Context) => {
    const cms = c.get('cms');
    try {
        if (await cms.settings.get('analytics.enabled') === false) return c.body(null, 204);
        const agent = c.req.header('user-agent') ?? '';
        if (CmsTraffic.crawler(agent)) return c.body(null, 204);
        const body = await c.req.json().catch(() => null) as { p?: unknown; r?: unknown } | null;
        const path = typeof body?.p === 'string' ? body.p : '';
        const referrer = typeof body?.r === 'string' ? body.r : '';
        await cms.traffic.recordView({ path, referrer, visitor: `${getClientIp(c)}|${agent}`, origin: new URL(c.req.url).origin });
    } catch { /* a beacon never fails the page */ }
    return c.body(null, 204, { 'cache-control': 'no-store' });
};
