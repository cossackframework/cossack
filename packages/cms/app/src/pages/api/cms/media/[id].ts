import type { Context } from 'hono';
import { answer } from '../../../../cms/content-api';
import { mediaUpdate } from '../../../../cms/manage';

/** Change a file's title, alternative text, caption or description: `PATCH /api/cms/media/<id>` with `{ title?, alt?, caption?, description? }`. */
export const PATCH = (c: Context) => answer(c, body => mediaUpdate(c, c.req.param('id') ?? '', body), { write: true });
