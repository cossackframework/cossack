import type { Context } from 'hono';
import { answer } from '../../../../../../../../cms/content-api';
import { entryRevision } from '../../../../../../../../cms/manage';

/** One revision's content: `GET /api/cms/content/posts/<id>/revisions/<n>`. */
export const GET = (c: Context) => answer(c, () => entryRevision(c, c.req.param('collection') ?? '', c.req.param('entry') ?? '', Number(c.req.param('revision'))));
