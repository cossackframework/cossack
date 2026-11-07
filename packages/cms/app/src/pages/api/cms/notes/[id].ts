import type { Context } from 'hono';
import { answer } from '../../../../cms/content-api';
import { noteChange, noteRemove } from '../../../../cms/manage';

/**
 * Change a note: `PATCH /api/cms/notes/<id>` with `body` (its author alone) and, on a thread's
 * root, `status` (`open` or `resolved`, anyone who may edit the entry). Editors with the entry
 * open see the change when they next join its room.
 */
export const PATCH = (c: Context) => answer(c, body => noteChange(c, c.req.param('id') ?? '', body), { write: true });

/** Remove a note (its author, or a user administrator); a thread's root takes its replies: `DELETE /api/cms/notes/<id>`. */
export const DELETE = (c: Context) => answer(c, () => noteRemove(c, c.req.param('id') ?? ''), { write: true });
