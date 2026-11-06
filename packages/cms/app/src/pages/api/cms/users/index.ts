import type { Context } from 'hono';
import { answer } from '../../../../cms/content-api';
import { userCreate, usersList } from '../../../../cms/manage';

/** The site's users: `GET /api/cms/users?q=ada&role=editor&page=1&perPage=20`. Needs the users permission. */
export const GET = (c: Context) => answer(c, () => usersList(c, c.req.query()));

/**
 * A new user: `POST /api/cms/users` with `{ email, password, name?, roles? }`. Roles (IDs such as
 * `editor`) take a role manager; without them the account gets General settings' default role.
 */
export const POST = (c: Context) => answer(c, body => userCreate(c, body), { write: true, status: 201 });
