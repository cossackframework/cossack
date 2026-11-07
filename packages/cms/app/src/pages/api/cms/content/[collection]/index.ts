import type { Context } from 'hono';
import { answer, apiHeaders } from '../../../../../cms/content-api';
import { entriesList, entryCreate } from '../../../../../cms/manage';

/**
 * Entries of a collection: `GET /api/cms/content/posts?page=2&perPage=10`. Visitors get published
 * entries, newest first; signed-in readers add `status=draft` (or `pending`, `scheduled`,
 * `published`, `trash`, `any`). `term=categories:news` lists a term's entries, including those of
 * terms below it; `q` searches; `locale=fr` lists one language's entries; `filter[field]=value`
 * matches a field; `format=html` adds rendered rich text beside the JSON documents.
 */
export const GET = (c: Context) => answer(c, async () => {
    const page = await entriesList(c, c.req.param('collection') ?? '', c.req.query());
    apiHeaders(c);
    return page;
});

/**
 * Create an entry: `POST /api/cms/content/posts` with the fields as JSON, such as
 * `{ "title": "Hello", "body": { "type": "doc", "content": [...] }, "status": "published" }`.
 * Terms are IDs. Needs a session or an application password that may write.
 */
export const POST = (c: Context) => answer(c, body => entryCreate(c, c.req.param('collection') ?? '', body), { write: true, status: 201 });
