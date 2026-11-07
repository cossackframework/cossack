import type { Context } from 'hono';
import { answer } from '../../../../../cms/content-api';
import { termCreate, termsList } from '../../../../../cms/manage';

/** A taxonomy's terms: `GET /api/cms/terms/categories?q=news&page=1&perPage=50`. */
export const GET = (c: Context) => answer(c, () => termsList(c, c.req.param('taxonomy') ?? '', c.req.query()));

/** A new term: `POST /api/cms/terms/categories` with `{ name, slug?, description?, parent? }`. Needs the terms permission. */
export const POST = (c: Context) => answer(c, body => termCreate(c, c.req.param('taxonomy') ?? '', body), { write: true, status: 201 });
