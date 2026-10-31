import type { Context } from 'hono';
import { indexedRowField, type FieldFilter } from '@cossackframework/cms';
import { apiEntries, apiError, apiHeaders, writeAllowed, writeBody } from '../../../../../cms/content-api';

/**
 * Published entries of a collection, newest first: `GET /api/cms/content/posts?page=2&perPage=10`.
 * `term=categories:news` lists a term's entries, including those of terms below it; `q` searches;
 * `locale=fr` lists one language's entries; `format=html` adds rendered rich text beside the JSON documents.
 */
export const GET = async (c: Context) => {
    const cms = c.get('cms');
    const principal = c.get('principal');
    try {
        const collection = cms.collection(c.req.param('collection') ?? '');
        const repository = cms.resource(`cms/${collection.name}`);
        const page = Math.min(Math.max(Number.parseInt(c.req.query('page') ?? '1', 10) || 1, 1), 500);
        const perPage = Math.min(Math.max(Number.parseInt(c.req.query('perPage') ?? '10', 10) || 10, 1), 100);
        const publishable = collection.publishable !== false;
        const where: Record<string, FieldFilter> = publishable ? { status: 'published' } : {};
        const locale = c.req.query('locale');
        if (locale) {
            if (!(await cms.languages()).all.includes(locale)) return c.json({ error: `${locale} is not one of the site's languages.`, code: 'CMS_VALIDATION' }, 422);
            where.locale = locale;
        }
        const [taxonomy, slug] = (c.req.query('term') ?? '').split(':', 2);
        if (taxonomy && slug) {
            if (!(collection.taxonomies ?? []).includes(taxonomy)) return c.json({ error: `${collection.label} do not use ${taxonomy}.`, code: 'CMS_VALIDATION' }, 422);
            const term = await cms.taxonomies.bySlug(taxonomy, slug);
            if (!term) return c.json({ error: 'Term not found.', code: 'CMS_NOT_FOUND' }, 404);
            where[taxonomy] = { containsAny: (await cms.taxonomies.subtree(term.id)).slice(0, 50) };
        }
        // `filter[price]=10`, `filter[specs.name]=Weight`: equality on a scalar field, membership on a multiple field or an indexed row field.
        for (const [key, raw] of Object.entries(c.req.query())) {
            const name = /^filter\[([a-zA-Z0-9_.]{1,200})\]$/.exec(key)?.[1];
            if (!name || typeof raw !== 'string') continue;
            const fields = cms.resourceById(`cms/${collection.name}`).fields;
            const row = name.includes('.') ? indexedRowField(fields, name.split('.')) : null;
            const declaration = name.includes('.') ? row : fields[name];
            if (!declaration) return c.json({ error: `Cannot filter on ${name}.`, code: 'CMS_VALIDATION' }, 422);
            const kind = declaration.kind;
            const value = kind === 'integer' || kind === 'number' || (kind === 'datetime' && (row !== null || declaration.multiple)) ? Number(raw) : kind === 'boolean' ? raw === 'true' : raw;
            where[name] = declaration.multiple || row ? { contains: value } : value;
        }
        const query = (c.req.query('q') ?? '').trim().slice(0, 200);
        const html = c.req.query('format') === 'html';
        apiHeaders(c);
        if (query) {
            const records = await repository.search(query, { limit: perPage, where }, { principal });
            return c.json({ items: await apiEntries(cms, collection, records, html, principal), page: 1, pages: 1, total: records.length });
        }
        const order = publishable ? { field: 'publishedAt', direction: 'desc' as const } : { field: 'title', direction: 'asc' as const };
        const [list, total] = await Promise.all([
            repository.list({ where, order, limit: perPage, offset: Math.min((page - 1) * perPage, 10_000) }, { principal }),
            repository.count({ where }, { principal }),
        ]);
        return c.json({ items: await apiEntries(cms, collection, list.records, html, principal), page, pages: Math.max(1, Math.ceil(total / perPage)), total });
    } catch (error) { return apiError(c, error); }
};

/**
 * Create an entry: `POST /api/cms/content/posts` with the fields as JSON, such as
 * `{ "title": "Hello", "body": { "type": "doc", "content": [...] }, "status": "published" }`.
 * Terms are IDs. Needs a session or an application password that may write.
 */
export const POST = async (c: Context) => {
    const refused = writeAllowed(c);
    if (refused) return refused;
    const body = await writeBody(c);
    if (body instanceof Response) return body;
    const cms = c.get('cms');
    try {
        const collection = cms.collection(c.req.param('collection') ?? '');
        const record = await cms.resource(`cms/${collection.name}`).create(body, { principal: c.get('principal') });
        c.header('cache-control', 'no-store');
        return c.json({ item: (await apiEntries(cms, collection, [record], false))[0] }, 201);
    } catch (error) { return apiError(c, error); }
};
