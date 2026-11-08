/**
 * What follows a note outside the entry's room: the webhook events `note.created` and
 * `note.resolved` for the entry's collection, and the email to the people a new note names
 * (its mentions and, for a reply, the thread's earlier voices), with the Writing setting on and
 * an application that sends mail. Server-only; callers never wait for it.
 */
import { noteMail, type Note } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';

export interface NoteContext {
    /** The site's origin, for the link to the entry's notes. */
    readonly origin: string;
    /** The entry's dashboard route (`posts`, `app.tickets`). */
    readonly route: string;
    /** The collection's name, for webhooks; null for a plugin's resource, which webhooks do not cover. */
    readonly collection: string | null;
    readonly title: string;
    /** Who did it, by name. */
    readonly author: string;
}

export async function announceNote(cms: CmsHost, change: { readonly kind: 'created' | 'resolved'; readonly note: Note }, context: NoteContext): Promise<void> {
    const { note } = change;
    const url = `${context.origin}/dashboard/content/${context.route}/${note.recordId}?notes=open`;
    const event = change.kind === 'created' ? 'note.created' : 'note.resolved';
    if (context.collection && await cms.webhooks.wants([event], context.collection).catch(() => false)) {
        await cms.webhooks.enqueue({
            event, eventId: change.kind === 'created' ? `note:${note.id}:created` : `note:${note.id}:resolved:${note.resolvedAt ?? 0}`, at: cms.now(), collection: context.collection,
            entry: { id: note.recordId, title: context.title, url }, note: { ...note },
        }).catch(error => console.warn('[cms] a note webhook could not be queued', error));
    }
    if (change.kind !== 'created' || !cms.mail || !(await cms.settings.get('writing.notesEmail').catch(() => false))) return;
    const people = await cms.users.getMany(await cms.notes.mentioned(note.id));
    if (!people.size) return;
    const site = String((await cms.settings.get('general.siteTitle').catch(() => '')) ?? '');
    const message = noteMail({ author: context.author, title: context.title, body: note.body, quote: note.quote, url, reply: note.parentId !== null, site });
    for (const person of people.values()) {
        if (person.status !== 'active' || !person.email) continue;
        await cms.mail.send({ kind: 'note', to: person.email, from: cms.mailFrom, subject: message.subject, text: message.text }).catch(error => console.warn(`[cms] the note email to ${person.email} failed`, error));
    }
}
