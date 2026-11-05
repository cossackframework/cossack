/**
 * Notes: review comments editors leave for each other on an entry, a field, a block or a
 * passage of rich text, as Google Docs comments and WordPress 6.9 Notes. They live in their own
 * tables beside the content, never in the collection's records, and travel live through the
 * entry's room. Client-safe: the shapes, the anchors, the mentions and the rules; the host
 * stores them (`server/notes.ts`).
 */
import { CmsError } from './errors';

export const NOTE_STATUSES = Object.freeze(['open', 'resolved'] as const);
export type NoteStatus = (typeof NOTE_STATUSES)[number];

export const NOTE_LIMITS = Object.freeze({
    /** A note's text, in characters. */
    body: 4000,
    /** The text a note on a passage quotes, in characters. */
    quote: 200,
    /** Notes one entry holds, roots and replies together. */
    perEntry: 500,
    /** People one note mentions. */
    mentions: 20,
});

/** Where a note is anchored. A text note also stores the passage's range and quote. */
export type NoteTarget =
    | { readonly kind: 'entry' }
    | { readonly kind: 'field'; readonly field: string }
    | { readonly kind: 'block'; readonly field: string; readonly block: string }
    /** A passage of a rich text document, named by its `richTextPath` (`body`, `content:b1.text`). */
    | { readonly kind: 'text'; readonly path: string };

/** A passage of rich text, as ProseMirror positions when the note was made or last moved. */
export interface NoteRange {
    readonly from: number;
    readonly to: number;
}

export interface Note {
    readonly id: string;
    /** The entry's resource, such as `cms/posts`, and ID. */
    readonly resource: string;
    readonly recordId: string;
    /** The thread's root for a reply; null on a root. */
    readonly parentId: string | null;
    readonly userId: string;
    /** The anchor, as `formatNoteTarget` writes it: `entry`, `field:title`, `block:content:b1`, `text:content:b1.text`. */
    readonly target: string;
    readonly range: NoteRange | null;
    readonly quote: string;
    /** Plain text, with mentions as `@[Name](userId)`. */
    readonly body: string;
    /** On a root: the thread's status. Replies carry `open`. */
    readonly status: NoteStatus;
    readonly resolvedBy: string | null;
    readonly resolvedAt: number | null;
    readonly createdAt: number;
    /** On a root: the thread's last activity (a reply, an edit, a resolution). */
    readonly updatedAt: number;
}

/** A root note with its replies, oldest first. */
export interface NoteThread {
    readonly root: Note;
    readonly replies: readonly Note[];
}

const NAME = /^[a-z][a-zA-Z0-9_]{0,62}$/;
/** A field anchor is a presence anchor without rows: a resource field, or a key such as `seo.description`. */
const FIELD = /^[a-z][a-zA-Z0-9_.]{0,100}$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;

export function formatNoteTarget(target: NoteTarget): string {
    switch (target.kind) {
        case 'entry': return 'entry';
        case 'field': return `field:${target.field}`;
        case 'block': return `block:${target.field}:${target.block}`;
        case 'text': return `text:${target.path}`;
    }
}

/** The anchor a stored target names, or null for one the editor cannot place. */
export function parseNoteTarget(text: unknown): NoteTarget | null {
    if (typeof text !== 'string' || text.length > 200) return null;
    if (text === 'entry') return { kind: 'entry' };
    const [kind, ...rest] = text.split(':');
    if (kind === 'field' && rest.length === 1 && FIELD.test(rest[0]!)) return { kind: 'field', field: rest[0]! };
    if (kind === 'block' && rest.length === 2 && NAME.test(rest[0]!) && ID.test(rest[1]!)) return { kind: 'block', field: rest[0]!, block: rest[1]! };
    if (kind === 'text' && rest.length) {
        const path = rest.join(':');
        if (/^[a-z][a-zA-Z0-9_]{0,62}(?::[A-Za-z0-9_-]{1,80}\.[a-z][a-zA-Z0-9_]{0,62})?$/.test(path)) return { kind: 'text', path };
    }
    return null;
}

/** The anchor's block, when it is a block or a passage inside one (`content:b1.text` is in block `b1`). */
export function noteBlock(target: NoteTarget): { field: string; block: string } | null {
    if (target.kind === 'block') return { field: target.field, block: target.block };
    if (target.kind === 'text') {
        const match = /^([^:]+):([^.]+)\./.exec(target.path);
        if (match) return { field: match[1]!, block: match[2]! };
    }
    return null;
}

/** The anchor's field: the field itself, the field a block or a passage is in, or null on the entry. */
export function noteField(target: NoteTarget): string | null {
    if (target.kind === 'entry') return null;
    if (target.kind === 'text') return target.path.split(':')[0]!;
    return target.field;
}

/** A trimmed note body within the limit, or a validation error. */
export function checkNoteBody(value: unknown): string {
    const body = (typeof value === 'string' ? value : '').replace(/\r\n?/g, '\n').trim();
    if (!body) throw new CmsError('CMS_VALIDATION', 'Write a note.', { fields: { body: 'Write a note.' } });
    if ([...body].length > NOTE_LIMITS.body) throw new CmsError('CMS_VALIDATION', `Notes can be at most ${NOTE_LIMITS.body} characters.`, { fields: { body: `At most ${NOTE_LIMITS.body} characters.` } });
    return body;
}

/** A passage's range as two nonnegative positions in order, or null for anything else. */
export function checkNoteRange(value: unknown): NoteRange | null {
    if (!value || typeof value !== 'object') return null;
    const { from, to } = value as { from?: unknown; to?: unknown };
    if (typeof from !== 'number' || typeof to !== 'number' || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) return null;
    return { from, to };
}

/** A quote cut to the limit, single-spaced. */
export function checkNoteQuote(value: unknown): string {
    return (typeof value === 'string' ? value : '').replace(/\s+/g, ' ').trim().slice(0, NOTE_LIMITS.quote);
}

/** A mention in a body: `@[Ada Lovelace](userId)`. */
const MENTION = /@\[([^\]\n]{1,100})\]\(([A-Za-z0-9_-]{1,80})\)/g;

/** The user IDs a body mentions, each once, in order, at most `NOTE_LIMITS.mentions`. */
export function mentionsIn(body: string): string[] {
    const ids: string[] = [];
    for (const match of body.matchAll(MENTION)) if (!ids.includes(match[2]!)) ids.push(match[2]!);
    return ids.slice(0, NOTE_LIMITS.mentions);
}

/** A body as parts to render: plain text and mentions, each with the name and user ID. */
export function noteParts(body: string): ({ kind: 'text'; text: string } | { kind: 'mention'; name: string; user: string })[] {
    const parts: ({ kind: 'text'; text: string } | { kind: 'mention'; name: string; user: string })[] = [];
    let at = 0;
    for (const match of body.matchAll(MENTION)) {
        if (match.index > at) parts.push({ kind: 'text', text: body.slice(at, match.index) });
        parts.push({ kind: 'mention', name: match[1]!, user: match[2]! });
        at = match.index + match[0].length;
    }
    if (at < body.length) parts.push({ kind: 'text', text: body.slice(at) });
    return parts;
}

/** The mention token for a person, as the body stores it. */
export function mentionToken(user: { readonly id: string; readonly name: string }): string {
    return `@[${user.name.replace(/[\]\n]/g, ' ').slice(0, 100)}](${user.id})`;
}

/** The threads of an entry's notes: roots in the order given, each with its replies oldest first; a reply without its root is left out. */
export function noteThreads(notes: readonly Note[]): NoteThread[] {
    const replies = new Map<string, Note[]>();
    for (const note of notes) if (note.parentId) (replies.get(note.parentId) ?? replies.set(note.parentId, []).get(note.parentId)!).push(note);
    return notes.filter(note => !note.parentId).map(root => ({ root, replies: (replies.get(root.id) ?? []).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)) }));
}

/** What an editor asks the entry's room to do with notes. */
export type NoteAction =
    | { readonly kind: 'create'; readonly target: string; readonly range?: NoteRange | null; readonly quote?: string; readonly body: string; readonly parentId?: string | null }
    | { readonly kind: 'edit'; readonly id: string; readonly body: string }
    | { readonly kind: 'resolve' | 'reopen' | 'remove'; readonly id: string }
    /** Text notes' ranges after their passages moved, written back by the tab that saved. */
    | { readonly kind: 'move'; readonly moves: readonly { readonly id: string; readonly range: NoteRange }[] };

/** A note action from client input, with every field checked, or a validation error. */
export function checkNoteAction(value: unknown): NoteAction {
    const action = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const id = () => { if (typeof action.id !== 'string' || !ID.test(action.id)) throw new CmsError('CMS_VALIDATION', 'Which note?'); return action.id; };
    switch (action.kind) {
        case 'create': {
            const target = typeof action.target === 'string' ? action.target : 'entry';
            if (!parseNoteTarget(target)) throw new CmsError('CMS_VALIDATION', 'The note has no place to go.');
            const parentId = typeof action.parentId === 'string' && ID.test(action.parentId) ? action.parentId : null;
            return { kind: 'create', target, range: checkNoteRange(action.range), quote: checkNoteQuote(action.quote), body: checkNoteBody(action.body), parentId };
        }
        case 'edit': return { kind: 'edit', id: id(), body: checkNoteBody(action.body) };
        case 'resolve': case 'reopen': case 'remove': return { kind: action.kind, id: id() };
        case 'move': {
            const moves = (Array.isArray(action.moves) ? action.moves : []).slice(0, 100).flatMap(move => {
                const entry = move && typeof move === 'object' ? move as Record<string, unknown> : {};
                const range = checkNoteRange(entry.range);
                return typeof entry.id === 'string' && ID.test(entry.id) && range ? [{ id: entry.id, range }] : [];
            });
            return { kind: 'move', moves };
        }
        default: throw new CmsError('CMS_VALIDATION', 'Unknown note action.');
    }
}

/**
 * Where a quote sits in a text: the occurrence nearest `near`, or -1. Used to put a note back on
 * its words when the stored range no longer holds them.
 */
export function findQuote(text: string, quote: string, near: number): number {
    if (!quote) return -1;
    let best = -1;
    let from = 0;
    for (;;) {
        const at = text.indexOf(quote, from);
        if (at === -1) break;
        if (best === -1 || Math.abs(at - near) < Math.abs(best - near)) best = at;
        from = at + 1;
    }
    return best;
}
