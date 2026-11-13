import type { Context } from 'hono';
import { answer, apiHeaders } from '../../../cms/content-api';
import { siteSearch } from '../../../cms/manage';

/**
 * The site's search: `GET /api/cms/search?q=walrus+facts&page=2`. Published entries visitors may
 * read, from every collection (`collection=posts` for one), best first: `{ items: [{ collection,
 * id, title, url, snippet }], page, next, loose }`. A snippet is plain parts, `match` on the words
 * that matched. Every word is required; `loose` is true when nothing had them all and the items
 * have some. `locale=fr` searches one language on a site with several (default: the main one).
 */
export const GET = (c: Context) => answer(c, async () => {
    const found = await siteSearch(c, c.req.query());
    apiHeaders(c);
    return found;
});
