import type { Context } from 'hono';
import { apiError, writeAllowed, writeBody } from '../../../../cms/content-api';

/**
 * Start an upload the browser sends itself: answers where to PUT the bytes. With a bucket that
 * presigns (S3, R2 through its S3 API) the URL is the bucket's and `direct` is true; otherwise
 * the bytes go to `PUT /api/cms/uploads/<id>` on this application. Either way the browser
 * then posts `/api/cms/uploads/<id>/complete`, which checks the bytes and makes the file.
 */
export const POST = async (c: Context) => {
    const refused = writeAllowed(c);
    if (refused) return refused;
    const cms = c.get('cms');
    if (!cms.files) return c.json({ error: 'File storage is not configured.', code: 'CMS_UNAVAILABLE' }, 503);
    const body = await writeBody(c);
    if (body instanceof Response) return body;
    const name = typeof body.name === 'string' ? body.name : '';
    const size = typeof body.size === 'number' ? body.size : Number(body.size);
    if (!name || !Number.isSafeInteger(size)) return c.json({ error: 'Send the file\'s name, type and size.', code: 'CMS_VALIDATION' }, 400);
    try {
        const maxBytes = (await cms.settings.get('media.maxUploadMb')) * 1024 * 1024;
        const pending = await cms.files.begin({ name, contentType: typeof body.type === 'string' ? body.type : '', size }, { principal: c.get('principal'), maxBytes });
        const target = pending.direct ?? { url: new URL(`/api/cms/uploads/${pending.id}`, c.req.url).href, method: 'PUT' as const, headers: { 'content-type': pending.contentType } };
        return c.json({ id: pending.id, url: target.url, method: target.method, headers: target.headers, direct: pending.direct !== null }, 201);
    } catch (error) { return apiError(c, error); }
};
