import type { Context } from 'hono';
import { mediaUrl } from '@cossackframework/cms';
import { apiError, writeAllowed } from '../../../../../cms/content-api';

/** Finish an upload: the bytes are checked against the declared size and type, and the file is made. */
export const POST = async (c: Context) => {
    const refused = writeAllowed(c);
    if (refused) return refused;
    const cms = c.get('cms');
    if (!cms.files) return c.json({ error: 'File storage is not configured.', code: 'CMS_UNAVAILABLE' }, 503);
    try {
        const file = await cms.files.complete(c.req.param('id') ?? '', { principal: c.get('principal'), signal: c.req.raw.signal });
        return c.json({ file: { id: file.id, url: mediaUrl(file), title: file.title, alt: file.alt, contentType: file.contentType, width: file.width, height: file.height } }, 201);
    } catch (error) { return apiError(c, error); }
};
