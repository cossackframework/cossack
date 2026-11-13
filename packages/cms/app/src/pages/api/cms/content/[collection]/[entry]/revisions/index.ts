import type { Context } from 'hono';
import { answer } from '../../../../../../../cms/content-api';
import { entryRevisions } from '../../../../../../../cms/manage';

/** An entry's revisions, newest first: `GET /api/cms/content/posts/<id>/revisions?limit=20` answers `{ current, items: [{ revision, at, actor, title, status }] }`. */
export const GET = (c: Context) => answer(c, () => entryRevisions(c, c.req.param('collection') ?? '', c.req.param('entry') ?? '', c.req.query()));
