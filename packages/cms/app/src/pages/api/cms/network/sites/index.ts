import type { Context } from 'hono';
import { answer } from '../../../../../cms/content-api';
import { siteCreate, sitesList } from '../../../../../cms/manage';

/** The network's sites, the main site first: `GET /api/cms/network/sites?q=blog&status=active`, for network admins on the network host. */
export const GET = (c: Context) => answer(c, () => sitesList(c, c.req.query()));

/**
 * Add a site: `POST /api/cms/network/sites` with `{ name, host, admin?, language?, starter?, id? }`.
 * `host` is an address under the network's subdomain, such as `blog.example.com`; `admin` is
 * the email of a network account (the caller's when left out); `starter: false` leaves the site
 * empty for an import.
 */
export const POST = (c: Context) => answer(c, body => siteCreate(c, body), { write: true, status: 201 });
