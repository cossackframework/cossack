import type { Context } from 'hono';
import { answer } from '#app/cms/content-api';
import { taxonomiesList } from '#app/cms/manage';

/** The site's taxonomies, such as categories and tags: `GET /api/cms/taxonomies`. Their terms are at `/api/cms/terms/<taxonomy>`. */
export const GET = (c: Context) => answer(c, async () => taxonomiesList(c));
