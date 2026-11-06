import type { Context } from 'hono';
import { checkNoteRange, noteThreads, recordTitle } from '@cossackframework/cms';
import { apiError, writeAllowed, writeBody } from '../../../../../../cms/content-api';
import { announceNote } from '../../../../../../cms/notes-announce';
import { siteOrigin } from '../../../../../../cms/seo';

/**
 * An entry's review notes: `GET /api/cms/content/posts/<id>/notes` answers its threads, each a
 * root with its replies, oldest first; `?status=open` or `resolved` keeps one kind. Whoever
 * may read the entry reads its notes.
 */
export const GET = async (c: Context) => {
    const cms = c.get('cms');
    const principal = c.get('principal');
    try {
        const collection = cms.collection(c.req.param('collection') ?? '');
        const resource = `cms/${collection.name}`;
        const id = c.req.param('entry') ?? '';
        if (!(await cms.resource(resource).get(id, { principal }))) return c.json({ error: 'Entry not found.', code: 'CMS_NOT_FOUND' }, 404);
        const status = c.req.query('status');
        const threads = noteThreads(await cms.notes.forEntry(resource, id)).filter(thread => !status || thread.root.status === status);
        c.header('cache-control', 'private, no-store');
        return c.json({ threads });
    } catch (error) { return apiError(c, error); }
};

/**
 * A new thread, or a reply: `POST /api/cms/content/posts/<id>/notes` with `body` and, for a
 * thread, `target` (`entry`, `field:title`, `block:content:<blockId>`, `text:content:<blockId>.text`)
 * with `range` and `quote` on a passage; a reply names its thread as `parentId`. Whoever may edit
 * the entry writes notes. Editors with the entry open see the note when they next join its room.
 */
export const POST = async (c: Context) => {
    const refused = writeAllowed(c);
    if (refused) return refused;
    const body = await writeBody(c);
    if (body instanceof Response) return body;
    const cms = c.get('cms');
    const principal = c.get('principal');
    try {
        const collection = cms.collection(c.req.param('collection') ?? '');
        const resource = `cms/${collection.name}`;
        const id = c.req.param('entry') ?? '';
        const repository = cms.resource(resource);
        const record = await repository.get(id, { principal });
        if (!record) return c.json({ error: 'Entry not found.', code: 'CMS_NOT_FOUND' }, 404);
        if (principal.kind !== 'user' || !repository.canUpdate(record, principal)) return c.json({ error: 'Not allowed to leave notes on this entry.', code: 'CMS_FORBIDDEN' }, 403);
        const note = await cms.notes.create({
            resource, recordId: id, userId: principal.id, body: String(body.body ?? ''),
            ...(typeof body.parentId === 'string' ? { parentId: body.parentId } : { target: typeof body.target === 'string' ? body.target : 'entry', range: checkNoteRange(body.range), quote: typeof body.quote === 'string' ? body.quote : '' }),
        });
        const author = await cms.users.get(principal.id).catch(() => null);
        void announceNote(cms, { kind: 'created', note }, { origin: siteOrigin(c), route: collection.name, collection: collection.name, title: recordTitle(record, cms.resourceById(resource).titleField), author: author?.name || author?.email || principal.id })
            .catch(error => console.warn('[cms] a note could not be announced', error));
        c.header('cache-control', 'no-store');
        return c.json({ note }, 201);
    } catch (error) { return apiError(c, error); }
};
