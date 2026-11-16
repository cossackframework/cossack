import type { Context } from 'hono';
import { answer } from '#app/cms/content-api';
import { mediaUpdate } from '#app/cms/manage';

/** Change a file's title, alternative text, caption or description: `PATCH /api/cms/media/<id>` with `{ title?, alt?, caption?, description? }`. */
export const PATCH = (c: Context) => answer(c, body => mediaUpdate(c, c.req.param('id') ?? '', body), { write: true });
