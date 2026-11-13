/**
 * What follows a note outside the entry's room: the webhook events `note.created` and
 * `note.resolved` for the entry's collection, and the email to the people a new note names
 * (its mentions and, for a reply, the thread's earlier voices), with the Writing setting on and
 * an application that sends mail. Server-only; it runs from the outbox job the note's write queued
 * (`announceNoteEvent`).
 */
import { noteMail, type Note } from '@cossackframework/cms';
import type { CmsHost, NoteAnnouncedEvent } from '@cossackframework/cms/server';

/** The `note.announced` outbox job, queued with the note's write: the note as it is now, announced. */
export async function announceNoteEvent(cms: CmsHost, event: NoteAnnouncedEvent): Promise<void> {
    const note = await cms.notes.get(event.noteId);
    // A note removed before the job ran is not announced.
    if (!note) return;
    await announceNote(cms, { kind: event.kind, note }, event.context);
}

export interface NoteContext {
    /**
     * The site's configured origin, for the link to the entry's notes (`mailOrigin`): null without
     * one, when emails carry no link and webhooks a path, never an address the request named.
     */
    readonly origin: string | null;
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
    const path = `/dashboard/content/${context.route}/${note.recordId}?notes=open`;
    const url = context.origin ? `${context.origin}${path}` : path;
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
    const message = noteMail({ author: context.author, title: context.title, body: note.body, quote: note.quote, url: context.origin ? url : '', reply: note.parentId !== null, site });
    for (const person of people.values()) {
        if (person.status !== 'active' || !person.email || !(await mayReadNotes(cms, note, person.id))) continue;
        await cms.mail.send({ kind: 'note', to: person.email, from: cms.mailFrom, subject: message.subject, text: message.text }).catch(error => console.warn(`[cms] the note email to ${person.email} failed`, error));
    }
}

/** Whether the member may read the entry's notes (edit the entry, as the notes API asks): a mention does not show them a note they cannot open. */
async function mayReadNotes(cms: CmsHost, note: Note, userId: string): Promise<boolean> {
    try {
        const principal = await cms.users.principal(userId);
        if (!principal) return false;
        const repository = cms.resource(note.resource);
        const record = await repository.get(note.recordId, { principal });
        return record !== null && repository.canUpdate(record, principal);
    } catch { return false; }
}
