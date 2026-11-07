import type { Context } from 'hono';
import { CmsError } from '@cossackframework/cms';
import { answer, apiHeaders, writeAllowed, writeBody } from '../../../../../cms/content-api';
import { entryDelete, entryRead, entryUpdate } from '../../../../../cms/manage';

/**
 * One entry by slug (published only) or by ID (whatever the reader may see, such as their own
 * drafts): `GET /api/cms/content/posts/hello-world`. `?preview=<token>` reads an unpublished
 * entry through its preview link. The answer lists the synced patterns its rich text uses and,
 * on a site with several languages, its translations.
 */
export const GET = (c: Context) => answer(c, async () => {
    const preview = c.req.query('preview');
    const view = await entryRead(c, c.req.param('collection') ?? '', c.req.param('entry') ?? '', { ...(preview ? { preview } : {}), html: c.req.query('format') === 'html' });
    if (!view) throw new CmsError('CMS_NOT_FOUND', 'Entry not found.');
    if (preview) c.header('cache-control', 'private, no-store'); else apiHeaders(c);
    return view;
});

/**
 * Change an entry: `PATCH /api/cms/content/posts/<id>` with `rev` (the revision you read, or
 * an `If-Match` header) and the fields to change. A stale revision answers 409.
 */
export const PATCH = async (c: Context) => {
    const refused = writeAllowed(c);
    if (refused) return refused;
    const body = await writeBody(c);
    if (body instanceof Response) return body;
    const { rev, ...fields } = body;
    const expected = rev ?? c.req.header('if-match')?.replaceAll('"', '');
    if (expected === undefined || expected === '') return c.json({ error: 'Send the revision you read as rev, or in If-Match.', code: 'CMS_VALIDATION' }, 428);
    return answer(c, () => entryUpdate(c, c.req.param('collection') ?? '', c.req.param('entry') ?? '', fields, expected));
};

/** Delete an entry permanently: `DELETE /api/cms/content/posts/<id>?rev=3`. */
export const DELETE = async (c: Context) => {
    const refused = writeAllowed(c);
    if (refused) return refused;
    const expected = c.req.query('rev') ?? c.req.header('if-match')?.replaceAll('"', '');
    if (expected === undefined || expected === '') return c.json({ error: 'Send the revision you read as ?rev=, or in If-Match.', code: 'CMS_VALIDATION' }, 428);
    return answer(c, () => entryDelete(c, c.req.param('collection') ?? '', c.req.param('entry') ?? '', expected));
};
