import type { Context } from 'hono';
import { apiError } from '../../../../../../../../cms/content-api';

/**
 * A file sent with a form submission: `GET /api/cms/forms/<form>/submissions/<id>/files/<file>`,
 * for a session or an application password with `cms:submissions`, as the submissions screen
 * links it. Form files are private: the public `/media/` route never serves them. Always a
 * download, never shown in the site's origin.
 */
export const GET = async (c: Context) => {
    const cms = c.get('cms');
    try {
        const form = await cms.forms.get(c.req.param('slug') ?? '');
        if (!form) return c.json({ error: 'This form does not exist.', code: 'CMS_NOT_FOUND' }, 404);
        const opened = await cms.forms.file(form, c.req.param('submission') ?? '', c.req.param('file') ?? '', c.get('principal'), { signal: c.req.raw.signal });
        if (!opened) return c.json({ error: 'This file does not exist.', code: 'CMS_NOT_FOUND' }, 404, { 'cache-control': 'private, no-store' });
        const { file, body } = opened;
        return new Response(body, { headers: {
            'content-type': file.contentType, 'content-length': String(file.size),
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'; sandbox",
        } });
    } catch (error) { return apiError(c, error); }
};
