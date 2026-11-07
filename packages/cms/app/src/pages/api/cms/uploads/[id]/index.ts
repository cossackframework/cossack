import type { Context } from 'hono';
import { apiError, writeAllowed } from '../../../../../cms/content-api';

/** The bytes of an upload begun at `POST /api/cms/uploads`, when the bucket does not take them directly. */
export const PUT = async (c: Context) => {
    const refused = writeAllowed(c);
    if (refused) return refused;
    const cms = c.get('cms');
    if (!cms.files) return c.json({ error: 'File storage is not configured.', code: 'CMS_UNAVAILABLE' }, 503);
    if (!c.req.raw.body) return c.json({ error: 'Send the file as the request body.', code: 'CMS_VALIDATION' }, 400);
    try {
        await cms.files.receive(c.req.param('id') ?? '', c.req.raw.body, { principal: c.get('principal'), signal: c.req.raw.signal });
        return c.body(null, 204);
    } catch (error) { return apiError(c, error); }
};
