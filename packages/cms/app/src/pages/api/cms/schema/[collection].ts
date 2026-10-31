import type { Context } from 'hono';
import { recordSchema } from '@cossackframework/cms';
import { apiError, apiHeaders } from '../../../../cms/content-api';
import { routeResource } from '../../../../cms/content';

/** The JSON Schema of a content type's entries: `GET /api/cms/schema/posts`. For validating writes and imports. */
export const GET = async (c: Context) => {
    try {
        const { resource } = routeResource(c.get('cms'), c.req.param('collection') ?? '');
        apiHeaders(c);
        return c.json(recordSchema(resource));
    } catch (error) { return apiError(c, error); }
};
