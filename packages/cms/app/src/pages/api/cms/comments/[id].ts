import type { Context } from 'hono';
import { answer } from '../../../../cms/content-api';
import { commentDelete, commentModerate } from '../../../../cms/manage';

/** Moderate a comment: `PATCH /api/cms/comments/<id>` with `{ status: approved | pending | spam | trash }`. */
export const PATCH = (c: Context) => answer(c, body => commentModerate(c, c.req.param('id') ?? '', body), { write: true });

/** Delete a comment for good: `DELETE /api/cms/comments/<id>`. */
export const DELETE = (c: Context) => answer(c, () => commentDelete(c, c.req.param('id') ?? ''), { write: true });
