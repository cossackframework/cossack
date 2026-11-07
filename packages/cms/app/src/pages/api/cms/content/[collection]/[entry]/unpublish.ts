import type { Context } from 'hono';
import { answer } from '../../../../../../cms/content-api';
import { entryUnpublish } from '../../../../../../cms/manage';

/** Take an entry off the site, back to a draft: `POST /api/cms/content/posts/<id>/unpublish` with an optional `rev`. */
export const POST = (c: Context) => answer(c, body => entryUnpublish(c, c.req.param('collection') ?? '', c.req.param('entry') ?? '', body), { write: true });
