import type { Context } from 'hono';
import { answer } from '#app/cms/content-api';
import { cachePurge } from '#app/cms/manage';

/** Purge the caches in front of the site: `POST /api/cms/cache/purge` with `{ tags?, urls? }`, or `{}` for every page. */
export const POST = (c: Context) => answer(c, body => cachePurge(c, body), { write: true });
