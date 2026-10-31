import type { Context } from 'hono';
import { apiEntries, apiError, apiHeaders, apiPatterns, writeAllowed, writeBody } from '../../../../../cms/content-api';

/**
 * One entry by slug (published only) or by ID (whatever the reader may see, such as their own
 * drafts): `GET /api/cms/content/posts/hello-world`. `?preview=<token>` reads an unpublished
 * entry through its preview link. The answer lists the synced patterns its rich text uses and,
 * on a site with several languages, its translations.
 */
export const GET = async (c: Context) => {
    const cms = c.get('cms');
    const principal = c.get('principal');
    try {
        const collection = cms.collection(c.req.param('collection') ?? '');
        const repository = cms.resource(`cms/${collection.name}`);
        const key = c.req.param('entry') ?? '';
        const token = c.req.query('preview');
        let record;
        if (token) {
            const preview = await cms.previewByToken(token);
            record = preview?.resource.id === `cms/${collection.name}` && preview.record.id === key ? preview.record : null;
            c.header('cache-control', 'private, no-store');
        } else {
            const bySlug = collection.slug !== false && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)
                ? (await repository.list({ where: { slug: key, ...(collection.publishable === false ? {} : { status: 'published' }) }, limit: 1 }, { principal })).records[0]
                : undefined;
            record = bySlug ?? await repository.get(key, { principal });
            apiHeaders(c);
        }
        if (!record) return c.json({ error: 'Entry not found.', code: 'CMS_NOT_FOUND' }, 404);
        const languages = await cms.languages();
        const translations = languages.multilingual ? Object.fromEntries(await Promise.all([...await cms.translations(collection, record, { principal })]
            .map(async ([code, entry]) => [code, { id: entry.id, url: (await cms.entryUrls(collection, [entry])).get(entry.id) ?? null }] as const))) : {};
        return c.json({ item: (await apiEntries(cms, collection, [record], c.req.query('format') === 'html', c.get('principal')))[0], patterns: await apiPatterns(cms, collection, [record]), translations });
    } catch (error) { return apiError(c, error); }
};

/**
 * Change an entry: `PATCH /api/cms/content/posts/<id>` with `rev` (the revision you read, or
 * an `If-Match` header) and the fields to change. A stale revision answers 409.
 */
export const PATCH = async (c: Context) => {
    const refused = writeAllowed(c);
    if (refused) return refused;
    const body = await writeBody(c);
    if (body instanceof Response) return body;
    const cms = c.get('cms');
    try {
        const collection = cms.collection(c.req.param('collection') ?? '');
        const { rev, ...fields } = body;
        const expected = Number(rev ?? c.req.header('if-match')?.replaceAll('"', ''));
        if (!Number.isSafeInteger(expected) || expected < 1) return c.json({ error: 'Send the revision you read as rev, or in If-Match.', code: 'CMS_VALIDATION' }, 428);
        const record = await cms.resource(`cms/${collection.name}`).update(c.req.param('entry') ?? '', fields, { principal: c.get('principal'), expectedRevision: expected });
        c.header('cache-control', 'no-store');
        return c.json({ item: (await apiEntries(cms, collection, [record], false))[0] });
    } catch (error) { return apiError(c, error); }
};

/** Delete an entry permanently: `DELETE /api/cms/content/posts/<id>?rev=3`. */
export const DELETE = async (c: Context) => {
    const refused = writeAllowed(c);
    if (refused) return refused;
    const cms = c.get('cms');
    try {
        const collection = cms.collection(c.req.param('collection') ?? '');
        const expected = Number(c.req.query('rev') ?? c.req.header('if-match')?.replaceAll('"', ''));
        if (!Number.isSafeInteger(expected) || expected < 1) return c.json({ error: 'Send the revision you read as ?rev=, or in If-Match.', code: 'CMS_VALIDATION' }, 428);
        await cms.resource(`cms/${collection.name}`).delete(c.req.param('entry') ?? '', { principal: c.get('principal'), expectedRevision: expected });
        return c.body(null, 204);
    } catch (error) { return apiError(c, error); }
};
