import type { Context } from 'hono';
import { hasPermission, PERMISSIONS, recordTitle, type Note, type Principal, type RecordShape } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import { apiError, writeAllowed, writeBody } from '../../../../cms/content-api';
import { announceNote } from '../../../../cms/notes-announce';
import { siteOrigin } from '../../../../cms/seo';

/** The note, its entry and whether the principal may edit that entry; a Response when not. */
async function editable(c: Context, cms: CmsHost, principal: Principal): Promise<{ note: Note; record: RecordShape } | Response> {
    const note = await cms.notes.get(c.req.param('id') ?? '');
    if (!note) return c.json({ error: 'Note not found.', code: 'CMS_NOT_FOUND' }, 404);
    const repository = cms.resource(note.resource);
    const record = await repository.get(note.recordId, { principal });
    if (!record) return c.json({ error: 'Note not found.', code: 'CMS_NOT_FOUND' }, 404);
    if (principal.kind !== 'user' || !repository.canUpdate(record, principal)) return c.json({ error: 'Not allowed to change notes on this entry.', code: 'CMS_FORBIDDEN' }, 403);
    return { note, record };
}

/**
 * Change a note: `PATCH /api/cms/notes/<id>` with `body` (its author alone) and, on a thread's
 * root, `status` (`open` or `resolved`, anyone who may edit the entry). Editors with the entry
 * open see the change when they next join its room.
 */
export const PATCH = async (c: Context) => {
    const refused = writeAllowed(c);
    if (refused) return refused;
    const body = await writeBody(c);
    if (body instanceof Response) return body;
    const cms = c.get('cms');
    const principal = c.get('principal') as Principal & { kind: 'user' };
    try {
        const found = await editable(c, cms, principal);
        if (found instanceof Response) return found;
        let note = found.note;
        if (typeof body.body === 'string') {
            if (note.userId !== principal.id) return c.json({ error: 'Only its author changes a note.', code: 'CMS_FORBIDDEN' }, 403);
            note = (await cms.notes.edit(note.id, body.body)) ?? note;
        }
        if (body.status !== undefined) {
            if (note.parentId) return c.json({ error: 'Resolve the thread, not a reply.', code: 'CMS_VALIDATION' }, 422);
            if (body.status !== 'open' && body.status !== 'resolved') return c.json({ error: 'status must be open or resolved.', code: 'CMS_VALIDATION' }, 422);
            note = (await cms.notes.setStatus(note.id, body.status, principal.id)) ?? note;
            if (note.status === 'resolved') {
                const [owner, name] = note.resource.split('/');
                const author = await cms.users.get(principal.id).catch(() => null);
                void announceNote(cms, { kind: 'resolved', note }, { origin: siteOrigin(c), route: owner === 'cms' ? name! : `${owner}.${name}`, collection: owner === 'cms' ? name! : null,
                    title: recordTitle(found.record, cms.resourceById(note.resource).titleField), author: author?.name || author?.email || principal.id })
                    .catch(error => console.warn('[cms] a note could not be announced', error));
            }
        }
        c.header('cache-control', 'no-store');
        return c.json({ note });
    } catch (error) { return apiError(c, error); }
};

/** Remove a note (its author, or a user administrator); a thread's root takes its replies: `DELETE /api/cms/notes/<id>`. */
export const DELETE = async (c: Context) => {
    const refused = writeAllowed(c);
    if (refused) return refused;
    const cms = c.get('cms');
    const principal = c.get('principal') as Principal & { kind: 'user' };
    try {
        const found = await editable(c, cms, principal);
        if (found instanceof Response) return found;
        if (found.note.userId !== principal.id && !hasPermission(principal, PERMISSIONS.manageUsers)) return c.json({ error: 'Only its author or an administrator removes a note.', code: 'CMS_FORBIDDEN' }, 403);
        await cms.notes.remove(found.note.id);
        return c.body(null, 204);
    } catch (error) { return apiError(c, error); }
};
