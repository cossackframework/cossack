import type { Context } from 'hono';
import { answer } from '../../../../cms/content-api';
import { redirectCreate, redirectsList } from '../../../../cms/manage';

/** The site's redirects: `GET /api/cms/redirects?q=&page=&perPage=`. Needs the redirects permission. */
export const GET = (c: Context) => answer(c, () => redirectsList(c, c.req.query()));

/** A new redirect: `POST /api/cms/redirects` with `{ source, target, status?, note? }`. */
export const POST = (c: Context) => answer(c, body => redirectCreate(c, body), { write: true, status: 201 });
