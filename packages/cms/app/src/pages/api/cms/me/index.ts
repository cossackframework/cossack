import type { Context } from 'hono';
import { answer } from '../../../../cms/content-api';
import { whoami } from '../../../../cms/manage';

/** Who the request acts as: `GET /api/cms/me` answers the user, their roles and permissions, the site, the application password's access and the network's state. */
export const GET = (c: Context) => answer(c, () => whoami(c));
