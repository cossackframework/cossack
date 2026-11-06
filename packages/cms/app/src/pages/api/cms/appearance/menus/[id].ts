import type { Context } from 'hono';
import { answer } from '../../../../../cms/content-api';
import { menuDelete, menuRead, menuUpdate } from '../../../../../cms/manage';

/** One menu with its items tree, `rev` and locations: `GET /api/cms/appearance/menus/<id>`. */
export const GET = (c: Context) => answer(c, () => menuRead(c, c.req.param('id') ?? ''));

/** Rename a menu, replace its items or move it: `PATCH /api/cms/appearance/menus/<id>` with any of `name`, `items`, `locations`, and `rev` (the revision read; stale answers 409). */
export const PATCH = (c: Context) => answer(c, body => menuUpdate(c, c.req.param('id') ?? '', body), { write: true });

/** Delete a menu; the locations it held show none: `DELETE /api/cms/appearance/menus/<id>`. */
export const DELETE = (c: Context) => answer(c, () => menuDelete(c, c.req.param('id') ?? ''), { write: true });
