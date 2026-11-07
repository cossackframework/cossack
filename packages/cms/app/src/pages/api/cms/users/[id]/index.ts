import type { Context } from 'hono';
import { answer } from '../../../../../cms/content-api';
import { userDelete, userGet, userUpdate } from '../../../../../cms/manage';

/** One user, by ID or email: `GET /api/cms/users/<id>`. */
export const GET = (c: Context) => answer(c, () => userGet(c, c.req.param('id') ?? ''));

/** Change a user: `PATCH /api/cms/users/<id>` with any of `name`, `email`, `password`, `roles` (role managers) and `status` (`active` or `disabled`). */
export const PATCH = (c: Context) => answer(c, body => userUpdate(c, c.req.param('id') ?? '', body), { write: true });

/** Delete a user (on an added site, remove the member): `DELETE /api/cms/users/<id>`. Never your own account. */
export const DELETE = (c: Context) => answer(c, () => userDelete(c, c.req.param('id') ?? ''), { write: true });
