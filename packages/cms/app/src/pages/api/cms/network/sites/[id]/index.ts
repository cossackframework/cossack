import type { Context } from 'hono';
import { answer } from '../../../../../../cms/content-api';
import { siteGet, siteSetStatus } from '../../../../../../cms/manage';

/** One site with its domains: `GET /api/cms/network/sites/<id>` (`main` for the main site). */
export const GET = (c: Context) => answer(c, () => siteGet(c, c.req.param('id') ?? ''));

/** Archive, restore or delete a site: `PATCH /api/cms/network/sites/<id>` with `{ status: "archived" | "active" | "deleted" }`. A deleted site can be restored for 30 days. */
export const PATCH = (c: Context) => answer(c, body => siteSetStatus(c, c.req.param('id') ?? '', body.status), { write: true });
