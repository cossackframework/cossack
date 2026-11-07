import type { Context } from 'hono';
import { answer } from '../../../../cms/content-api';
import { cachePurge } from '../../../../cms/manage';

/** Purge the caches in front of the site: `POST /api/cms/cache/purge` with `{ tags?, urls? }`, or `{}` for every page. */
export const POST = (c: Context) => answer(c, body => cachePurge(c, body), { write: true });
