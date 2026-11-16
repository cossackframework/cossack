import type { Context } from 'hono';
import { answer } from '#app/cms/content-api';
import { entryRevision } from '#app/cms/manage';

/** One revision's content: `GET /api/cms/content/posts/<id>/revisions/<n>`. */
export const GET = (c: Context) => answer(c, () => entryRevision(c, c.req.param('collection') ?? '', c.req.param('entry') ?? '', Number(c.req.param('revision'))));
