import type { Context } from 'hono';
import { answer } from '../../../../../cms/content-api';
import { menuLocationAssign } from '../../../../../cms/manage';

/** Show a menu at a location, or none: `PATCH /api/cms/appearance/locations/<location>` with `{ menu: "<id>" }` or `{ menu: null }`. */
export const PATCH = (c: Context) => answer(c, body => menuLocationAssign(c, c.req.param('location') ?? '', body), { write: true });
