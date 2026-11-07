import type { Context } from 'hono';
import { answer } from '../../../../../cms/content-api';
import { tokenRevoke } from '../../../../../cms/manage';

/** Revoke one of the signed-in user's application passwords: `DELETE /api/cms/me/tokens/<id>`; the one in use may revoke itself. */
export const DELETE = (c: Context) => answer(c, () => tokenRevoke(c, c.req.param('id') ?? ''), { write: true });
