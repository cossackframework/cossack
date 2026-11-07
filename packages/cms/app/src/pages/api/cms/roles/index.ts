import type { Context } from 'hono';
import { answer } from '../../../../cms/content-api';
import { rolesList } from '../../../../cms/manage';

/** The site's roles with their permissions: `GET /api/cms/roles`, for user and role managers. */
export const GET = (c: Context) => answer(c, () => rolesList(c));
