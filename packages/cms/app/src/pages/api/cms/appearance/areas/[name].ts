import type { Context } from 'hono';
import { answer } from '../../../../../cms/content-api';
import { areaRead, areaReset, areaUpdate } from '../../../../../cms/manage';

/** One widget area with its blocks and `rev` (0 while the theme's defaults show): `GET /api/cms/appearance/areas/<name>`. */
export const GET = (c: Context) => answer(c, () => areaRead(c, c.req.param('name') ?? ''));

/** Replace an area's blocks: `PUT /api/cms/appearance/areas/<name>` with `{ blocks, rev? }`; `rev` is the revision read, stale answers 409. */
export const PUT = (c: Context) => answer(c, body => areaUpdate(c, c.req.param('name') ?? '', body), { write: true });

/** Forget the area's saved blocks so the theme's defaults show again: `DELETE /api/cms/appearance/areas/<name>`. */
export const DELETE = (c: Context) => answer(c, () => areaReset(c, c.req.param('name') ?? ''), { write: true });
