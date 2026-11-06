import type { Context } from 'hono';
import { answer } from '../../../../../../../../cms/content-api';
import { entryRestore } from '../../../../../../../../cms/manage';

/** Restore a revision's fields as a new revision: `POST /api/cms/content/posts/<id>/revisions/<n>/restore` with an optional `rev`. The entry's status and publication stay. */
export const POST = (c: Context) => answer(c, body => entryRestore(c, c.req.param('collection') ?? '', c.req.param('entry') ?? '', Number(c.req.param('revision')), body.rev), { write: true });
