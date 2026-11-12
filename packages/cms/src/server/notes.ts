/**
 * Notes: the rows of editors' review notes on entries (`notes.ts` has the shapes and rules).
 * A thread is a root note and its replies; the root carries the thread's status and its last
 * activity. Mentions get their own rows, so "notes for you" and the unseen count are one
 * query each. The entry's room checks who may do what; this class keeps the rows.
 */
import type { RomeDB, Statement, Value } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import { checkNoteBody, checkNoteQuote, checkNoteRange, mentionsIn, NOTE_LIMITS, NOTE_STATUSES, parseNoteTarget, type Note, type NoteRange, type NoteStatus } from '../notes';
import { inList } from './users';
import { readPaged } from './budget';
import { defineAction } from '@cossackframework/core/hooks';

/** What a note's announcement names besides the note: worked out by the caller, which knows the request and the entry. */
export interface NoteAnnouncement {
    /** The site's configured origin for links, or null. */
    readonly origin: string | null;
    /** The entry's dashboard route (`posts`, `app.tickets`). */
    readonly route: string;
    /** The collection's name, for webhooks; null for a plugin's resource. */
    readonly collection: string | null;
    readonly title: string;
    /** Who did it, by name. */
    readonly author: string;
}

/** The outbox job that announces a new or resolved note (webhooks, emails), queued with the note's own write. */
export interface NoteAnnouncedEvent {
    readonly eventId: string;
    readonly topic: 'note.announced';
    readonly at: number;
    readonly kind: 'created' | 'resolved';
    readonly noteId: string;
    readonly context: NoteAnnouncement;
}

/** Runs from the outbox; the application's `announceNote` handles it, plugins cannot hook it. */
export const noteAnnounced = defineAction<NoteAnnouncedEvent>('cms.note.announced', { version: 1, timeoutMs: 60_000 });

function announcementRow(kind: 'created' | 'resolved', noteId: string, at: number, context: NoteAnnouncement): Statement {
    const event: NoteAnnouncedEvent = { eventId: `note:${noteId}:${kind}:${crypto.randomUUID()}`, topic: 'note.announced', at, kind, noteId, context };
    return {
        rql: 'INSERT INTO cms_outbox (id, topic, payload, created_at, available_at, attempts, lease_until) VALUES ($eventId, $topic, $payload, $at, $at, 0, 0)',
        params: { $eventId: event.eventId, $topic: event.topic, $payload: JSON.stringify(event), $at: at },
    };
}

const WRITE = { kind: 'cms.notes', retryConflicts: 5 } as const;
const COLUMNS = 'id, resource, record_id, parent_id, user_id, target, text_range, quoted, body, status, resolved_by, resolved_at, created_at, updated_at';
const ID = /^[A-Za-z0-9_-]{1,80}$/;

export interface NoteInput {
    readonly resource: string;
    readonly recordId: string;
    /** The thread to reply in; a root note has none. */
    readonly parentId?: string | null;
    readonly userId: string;
    /** The anchor (`formatNoteTarget`); a reply takes its root's. */
    readonly target?: string;
    readonly range?: NoteRange | null;
    readonly quote?: string;
    readonly body: string;
}

export class CmsNotes {
    readonly #db: RomeDB;
    readonly #now: () => number;

    constructor(db: RomeDB, options: { now?: () => number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
    }

    async get(id: string): Promise<Note | null> {
        if (!ID.test(id)) return null;
        const result = await this.#db.read([{ rql: `SELECT ${COLUMNS} FROM cms_notes WHERE id = $id`, params: { $id: id } }]);
        const row = result.results[0]!.rows[0];
        return row ? noteOf(row) : null;
    }

    /** An entry's notes, roots and replies, oldest first. */
    async forEntry(resource: string, recordId: string): Promise<Note[]> {
        check(recordId);
        // Notes hold up to a few thousand characters each: read in pages that fit the result budget.
        const rows = await readPaged(this.#db, (limit, offset) => ({
            rql: `SELECT ${COLUMNS} FROM cms_notes WHERE resource = $resource AND record_id = $record ORDER BY created_at, id LIMIT $limit OFFSET $offset`,
            params: { $resource: resource, $record: recordId, $limit: limit, $offset: offset },
        }), NOTE_LIMITS.perEntry, 0);
        return rows.map(noteOf);
    }

    /**
     * A new thread, or a reply in one. A reply mentions the thread's author and everyone who
     * replied before, so they hear of it; a mention in the body adds its person.
     */
    async create(input: NoteInput, options: { announce?: NoteAnnouncement } = {}): Promise<Note> {
        check(input.recordId);
        if (!ID.test(input.userId)) throw new CmsError('CMS_VALIDATION', 'Invalid user.');
        const body = checkNoteBody(input.body);
        const now = this.#now();
        const id = crypto.randomUUID();
        let target = input.target ?? 'entry';
        let range: NoteRange | null = null;
        let quote = '';
        let mentioned = mentionsIn(body);
        if (input.parentId) {
            const root = await this.get(input.parentId);
            if (!root || root.parentId || root.resource !== input.resource || root.recordId !== input.recordId) throw new CmsError('CMS_NOT_FOUND', 'The note to reply to does not exist.');
            target = root.target;
            const result = await this.#db.read([{ rql: 'SELECT user_id FROM cms_notes WHERE id = $root OR parent_id = $root', params: { $root: root.id } }]);
            mentioned = [...new Set([...mentioned, ...result.results[0]!.rows.map(row => row[0] as string)])];
        } else {
            if (!parseNoteTarget(target)) throw new CmsError('CMS_VALIDATION', 'The note has no place to go.');
            range = target.startsWith('text:') ? checkNoteRange(input.range) : null;
            quote = target.startsWith('text:') ? checkNoteQuote(input.quote) : '';
        }
        const count = await this.#db.read([{ rql: 'SELECT count(*) FROM cms_notes WHERE resource = $resource AND record_id = $record', params: { $resource: input.resource, $record: input.recordId } }]);
        if (Number(count.results[0]!.rows[0]![0] as bigint) >= NOTE_LIMITS.perEntry) throw new CmsError('CMS_LIMIT', `An entry holds at most ${NOTE_LIMITS.perEntry} notes. Resolve and remove some first.`);
        const thread = input.parentId ?? id;
        const statements: Statement[] = [{
            rql: `INSERT INTO cms_notes (${COLUMNS}) VALUES ($id, $resource, $record, $parent, $user, $target, $range, $quote, $body, 'open', NULL, NULL, $now, $now)`,
            params: { $id: id, $resource: input.resource, $record: input.recordId, $parent: input.parentId ?? null, $user: input.userId, $target: target, $range: range ? JSON.stringify(range) : null, $quote: quote, $body: body, $now: now },
        }];
        if (input.parentId) statements.push({ rql: 'UPDATE cms_notes SET updated_at = $now WHERE id = $root', params: { $now: now, $root: input.parentId } });
        statements.push(...this.#mentionRows(id, thread, mentioned.filter(user => user !== input.userId), now, []));
        // Its webhooks and emails follow from the outbox, queued only when the note is.
        if (options.announce) statements.push(announcementRow('created', id, now, options.announce));
        await this.#db.write(statements, WRITE);
        return (await this.get(id))!;
    }

    /** Change a note's text; people it newly mentions hear of it. */
    async edit(id: string, body: string): Promise<Note | null> {
        const note = await this.get(id);
        if (!note) return null;
        const text = checkNoteBody(body);
        const now = this.#now();
        const known = await this.#db.read([{ rql: 'SELECT user_id FROM cms_note_mentions WHERE note_id = $id', params: { $id: id } }]);
        const statements: Statement[] = [{ rql: 'UPDATE cms_notes SET body = $body, updated_at = $now WHERE id = $id', params: { $body: text, $now: now, $id: id } }];
        if (note.parentId) statements.push({ rql: 'UPDATE cms_notes SET updated_at = $now WHERE id = $root', params: { $now: now, $root: note.parentId } });
        statements.push(...this.#mentionRows(id, note.parentId ?? id, mentionsIn(text).filter(user => user !== note.userId), now, known.results[0]!.rows.map(row => row[0] as string)));
        await this.#db.write(statements, WRITE);
        return this.get(id);
    }

    /** Resolve or reopen a thread, by its root. */
    async setStatus(id: string, status: NoteStatus, by: string, options: { announce?: NoteAnnouncement } = {}): Promise<Note | null> {
        if (!NOTE_STATUSES.includes(status)) throw new CmsError('CMS_VALIDATION', 'Unknown note status.');
        const note = await this.get(id);
        if (!note || note.parentId) return null;
        const now = this.#now();
        await this.#db.write([{
            rql: 'UPDATE cms_notes SET status = $status, resolved_by = $by, resolved_at = $at, updated_at = $now WHERE id = $id',
            params: { $status: status, $by: status === 'resolved' ? by : null, $at: status === 'resolved' ? now : null, $now: now, $id: id },
        }, ...(options.announce && status === 'resolved' ? [announcementRow('resolved', id, now, options.announce)] : [])], WRITE);
        return this.get(id);
    }

    /** Delete a note; a root takes its replies and the thread's mentions with it. */
    async remove(id: string): Promise<boolean> {
        const note = await this.get(id);
        if (!note) return false;
        await this.#db.write(note.parentId
            ? [{ rql: 'DELETE FROM cms_note_mentions WHERE note_id = $id', params: { $id: id } }, { rql: 'DELETE FROM cms_notes WHERE id = $id', params: { $id: id } }]
            : [{ rql: 'DELETE FROM cms_note_mentions WHERE thread_id = $id', params: { $id: id } }, { rql: 'DELETE FROM cms_notes WHERE id = $id OR parent_id = $id', params: { $id: id } }], WRITE);
        return true;
    }

    /** Text notes' ranges after the passages moved, at most 100 at a time. */
    async move(moves: readonly { id: string; range: NoteRange }[]): Promise<void> {
        const statements: Statement[] = [];
        for (const move of moves.slice(0, 100)) {
            const range = checkNoteRange(move.range);
            if (!ID.test(move.id) || !range) continue;
            statements.push({ rql: "UPDATE cms_notes SET text_range = $range WHERE id = $id AND parent_id IS NULL AND target LIKE 'text:%'", params: { $range: JSON.stringify(range), $id: move.id } });
        }
        if (statements.length) await this.#db.write(statements, WRITE);
    }

    /** The people a note names: its body's mentions and, for a reply, the thread's earlier voices; never its author. */
    async mentioned(noteId: string): Promise<string[]> {
        if (!ID.test(noteId)) return [];
        const result = await this.#db.read([{ rql: 'SELECT user_id FROM cms_note_mentions WHERE note_id = $id ORDER BY user_id', params: { $id: noteId } }]);
        return result.results[0]!.rows.map(row => row[0] as string);
    }

    /** Open threads per entry, for lists; entries without one are left out. */
    async counts(resource: string, recordIds: readonly string[]): Promise<Map<string, number>> {
        const ids = [...new Set(recordIds.filter(id => ID.test(id)))].slice(0, 100);
        if (!ids.length) return new Map();
        const list = inList('r', ids);
        const result = await this.#db.read([{
            rql: `SELECT record_id, count(*) FROM cms_notes WHERE resource = $resource AND parent_id IS NULL AND status = 'open' AND record_id IN ${list.rql} GROUP BY record_id`,
            params: { $resource: resource, ...list.params },
        }]);
        return new Map(result.results[0]!.rows.map(([id, count]) => [id as string, Number(count as bigint)]));
    }

    /** Open threads a person started or is mentioned in, newest activity first. */
    async forUser(userId: string, limit = 20): Promise<Note[]> {
        if (!ID.test(userId)) return [];
        const result = await this.#db.read([{
            rql: `SELECT ${COLUMNS} FROM cms_notes WHERE parent_id IS NULL AND status = 'open' AND (user_id = $user OR id IN (SELECT thread_id FROM cms_note_mentions WHERE user_id = $user))
                ORDER BY updated_at DESC, id DESC LIMIT ${Math.min(Math.max(limit, 1), 100)}`,
            params: { $user: userId },
        }]);
        return result.results[0]!.rows.map(noteOf);
    }

    /** Mentions of a person in open threads they have not opened yet. */
    async unseen(userId: string): Promise<number> {
        if (!ID.test(userId)) return 0;
        const result = await this.#db.read([{
            rql: "SELECT count(*) FROM cms_note_mentions WHERE user_id = $user AND seen_at IS NULL AND thread_id IN (SELECT id FROM cms_notes WHERE parent_id IS NULL AND status = 'open')",
            params: { $user: userId },
        }]);
        return Number(result.results[0]!.rows[0]![0] as bigint);
    }

    /** The person opened the entry: its mentions of them are seen. */
    async markSeen(userId: string, resource: string, recordId: string): Promise<void> {
        if (!ID.test(userId)) return;
        check(recordId);
        const pending = await this.#db.read([{
            rql: 'SELECT 1 FROM cms_note_mentions WHERE user_id = $user AND seen_at IS NULL AND thread_id IN (SELECT id FROM cms_notes WHERE resource = $resource AND record_id = $record AND parent_id IS NULL) LIMIT 1',
            params: { $user: userId, $resource: resource, $record: recordId },
        }]);
        if (!pending.results[0]!.rows.length) return;
        await this.#db.write([{
            rql: 'UPDATE cms_note_mentions SET seen_at = $now WHERE user_id = $user AND seen_at IS NULL AND thread_id IN (SELECT id FROM cms_notes WHERE resource = $resource AND record_id = $record AND parent_id IS NULL)',
            params: { $now: this.#now(), $user: userId, $resource: resource, $record: recordId },
        }], WRITE);
    }

    /** The entries that hold notes, in a stable order from `offset`, for maintenance to check they still exist. */
    async entries(limit = 200, offset = 0): Promise<{ resource: string; recordId: string }[]> {
        const result = await this.#db.read([{
            rql: `SELECT resource, record_id FROM cms_notes GROUP BY resource, record_id ORDER BY resource, record_id LIMIT ${Math.min(Math.max(limit, 1), 1000)} OFFSET ${Math.min(Math.max(Math.trunc(offset), 0), 1_000_000)}`,
        }]);
        return result.results[0]!.rows.map(row => ({ resource: row[0] as string, recordId: row[1] as string }));
    }

    /** Every note of an entry, such as one that no longer exists. */
    async purgeEntry(resource: string, recordId: string): Promise<void> {
        check(recordId);
        const params = { $resource: resource, $record: recordId };
        await this.#db.write([
            { rql: 'DELETE FROM cms_note_mentions WHERE thread_id IN (SELECT id FROM cms_notes WHERE resource = $resource AND record_id = $record AND parent_id IS NULL)', params },
            { rql: 'DELETE FROM cms_notes WHERE resource = $resource AND record_id = $record', params },
        ], WRITE);
    }

    #mentionRows(noteId: string, threadId: string, users: readonly string[], now: number, known: readonly string[]): Statement[] {
        return users.filter(user => ID.test(user) && !known.includes(user)).slice(0, NOTE_LIMITS.mentions).map(user => ({
            rql: 'INSERT INTO cms_note_mentions (note_id, thread_id, user_id, created_at, seen_at) VALUES ($note, $thread, $user, $now, NULL)',
            params: { $note: noteId, $thread: threadId, $user: user, $now: now },
        }));
    }
}

function check(recordId: string): void {
    if (!ID.test(recordId)) throw new CmsError('CMS_VALIDATION', 'Invalid entry.');
}

function noteOf(row: readonly Value[]): Note {
    let range: NoteRange | null = null;
    try { range = checkNoteRange(JSON.parse((row[6] as string | null) ?? 'null')); } catch { range = null; }
    return {
        id: row[0] as string, resource: row[1] as string, recordId: row[2] as string, parentId: (row[3] as string | null) ?? null, userId: row[4] as string,
        target: row[5] as string, range, quote: (row[7] as string | null) ?? '', body: row[8] as string, status: row[9] as NoteStatus,
        resolvedBy: (row[10] as string | null) ?? null, resolvedAt: row[11] === null || row[11] === undefined ? null : Number(row[11] as bigint),
        createdAt: Number(row[12] as bigint), updatedAt: Number(row[13] as bigint),
    };
}
