import type { Context } from 'hono';
import { apiError, apiHeaders } from '../../../../cms/content-api';

/** The menu assigned to a theme location, resolved for visitors: `GET /api/cms/menus/primary`. */
export const GET = async (c: Context) => {
    try {
        const location = c.req.param('location') ?? '';
        const items = await c.get('cms').menus.forLocation(location);
        apiHeaders(c);
        return c.json({ location, assigned: items !== null, items: items ?? [] });
    } catch (error) { return apiError(c, error); }
};
