import type { Context } from 'hono';
import { answer } from '../../../../../../cms/content-api';
import { noteAdd, notesForEntry } from '../../../../../../cms/manage';

/**
 * An entry's review notes: `GET /api/cms/content/posts/<id>/notes` answers its threads, each a
 * root with its replies, oldest first; `?status=open` or `resolved` keeps one kind. Whoever
 * may edit the entry reads its notes.
 */
export const GET = (c: Context) => answer(c, () => notesForEntry(c, c.req.param('collection') ?? '', c.req.param('entry') ?? '', c.req.query('status')));

/**
 * A new thread, or a reply: `POST /api/cms/content/posts/<id>/notes` with `body` and, for a
 * thread, `target` (`entry`, `field:title`, `block:content:<blockId>`, `text:content:<blockId>.text`)
 * with `range` and `quote` on a passage; a reply names its thread as `parentId`. Whoever may edit
 * the entry writes notes. Editors with the entry open see the note when they next join its room.
 */
export const POST = (c: Context) => answer(c, body => noteAdd(c, c.req.param('collection') ?? '', c.req.param('entry') ?? '', body), { write: true, status: 201 });
