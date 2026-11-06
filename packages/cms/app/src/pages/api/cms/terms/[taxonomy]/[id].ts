import type { Context } from 'hono';
import { answer } from '../../../../../cms/content-api';
import { termDelete, termRead, termUpdate } from '../../../../../cms/manage';

/** One term: `GET /api/cms/terms/categories/<id>`. */
export const GET = (c: Context) => answer(c, () => termRead(c, c.req.param('taxonomy') ?? '', c.req.param('id') ?? ''));

/** Change a term: `PATCH /api/cms/terms/categories/<id>` with any of `name`, `slug`, `description`, `parent`. */
export const PATCH = (c: Context) => answer(c, body => termUpdate(c, c.req.param('taxonomy') ?? '', c.req.param('id') ?? '', body), { write: true });

/** Delete a term; entries keep their other terms: `DELETE /api/cms/terms/categories/<id>`. */
export const DELETE = (c: Context) => answer(c, () => termDelete(c, c.req.param('taxonomy') ?? '', c.req.param('id') ?? ''), { write: true });
