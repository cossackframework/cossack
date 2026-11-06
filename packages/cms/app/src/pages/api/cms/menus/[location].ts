import type { Context } from 'hono';
import { apiError, apiHeaders } from '../../../../cms/content-api';
import { menuViews } from '../../../../cms/site';

/** The menu assigned to a theme location, resolved for visitors with typed fields and rendered panels: `GET /api/cms/menus/primary`. */
export const GET = async (c: Context) => {
    try {
        const location = c.req.param('location') ?? '';
        const cms = c.get('cms');
        const items = await cms.menus.forLocation(location);
        apiHeaders(c);
        return c.json({ location, assigned: items !== null, items: items ? await menuViews(cms, items) : [] });
    } catch (error) { return apiError(c, error); }
};
