import { describe, expect, it } from 'vitest';
import { checkNoteBody, checkNoteQuote, checkNoteRange, findQuote, formatNoteTarget, mentionsIn, mentionToken, noteBlock, noteField, noteMail, noteParts, notePlainText, noteThreads, NOTE_LIMITS, parseNoteTarget, type Note } from '../src/notes';

const note = (id: string, parentId: string | null, createdAt: number): Note => ({
    id, resource: 'cms/posts', recordId: 'p1', parentId, userId: 'ada', target: 'entry', range: null, quote: '', body: id, status: 'open', resolvedBy: null, resolvedAt: null, createdAt, updatedAt: createdAt,
});

describe('note anchors', () => {
    it('round-trips every kind of target and refuses the rest', () => {
        for (const target of [{ kind: 'entry' }, { kind: 'field', field: 'title' }, { kind: 'block', field: 'content', block: 'b1' }, { kind: 'text', path: 'body' }, { kind: 'text', path: 'content:b1.text' }] as const) {
            expect(parseNoteTarget(formatNoteTarget(target))).toEqual(target);
        }
        expect(formatNoteTarget({ kind: 'text', path: 'content:b1.text' })).toBe('text:content:b1.text');
        // A field anchor is also a sidebar key, such as the meta description's.
        expect(parseNoteTarget('field:seo.description')).toEqual({ kind: 'field', field: 'seo.description' });
        for (const bad of ['', 'field:', 'field:Title Case', 'block:content', 'block:content:b1:extra', 'text:', 'text:content:b1', 'nope', 42, null, 'x'.repeat(300)]) {
            expect(parseNoteTarget(bad)).toBeNull();
        }
    });

    it('names the field and block an anchor sits in', () => {
        expect(noteField({ kind: 'entry' })).toBeNull();
        expect(noteField({ kind: 'field', field: 'title' })).toBe('title');
        expect(noteField({ kind: 'block', field: 'content', block: 'b1' })).toBe('content');
        expect(noteField({ kind: 'text', path: 'content:b1.text' })).toBe('content');
        expect(noteField({ kind: 'text', path: 'body' })).toBe('body');
        expect(noteBlock({ kind: 'block', field: 'content', block: 'b1' })).toEqual({ field: 'content', block: 'b1' });
        expect(noteBlock({ kind: 'text', path: 'content:b1.text' })).toEqual({ field: 'content', block: 'b1' });
        expect(noteBlock({ kind: 'text', path: 'body' })).toBeNull();
        expect(noteBlock({ kind: 'field', field: 'title' })).toBeNull();
    });
});

describe('note bodies and ranges', () => {
    it('trims and bounds a body', () => {
        expect(checkNoteBody('  Needs a source.\r\nSee below. ')).toBe('Needs a source.\nSee below.');
        expect(() => checkNoteBody('   ')).toThrow(/Write a note/);
        expect(() => checkNoteBody(42)).toThrow(/Write a note/);
        expect(() => checkNoteBody('x'.repeat(NOTE_LIMITS.body + 1))).toThrow(/at most/);
    });

    it('keeps a range in order and a quote short', () => {
        expect(checkNoteRange({ from: 3, to: 9 })).toEqual({ from: 3, to: 9 });
        expect(checkNoteRange({ from: 3, to: 3 })).toEqual({ from: 3, to: 3 });
        expect(checkNoteRange({ from: 9, to: 3 })).toBeNull();
        expect(checkNoteRange({ from: -1, to: 3 })).toBeNull();
        expect(checkNoteRange({ from: 1.5, to: 3 })).toBeNull();
        expect(checkNoteRange(null)).toBeNull();
        expect(checkNoteQuote('  two\n  words  ')).toBe('two words');
        expect(checkNoteQuote('x'.repeat(500))).toHaveLength(NOTE_LIMITS.quote);
        expect(checkNoteQuote(undefined)).toBe('');
    });
});

describe('mentions', () => {
    it('finds each mentioned person once, in order, and renders the parts', () => {
        const body = `${mentionToken({ id: 'eve', name: 'Eve' })} and ${mentionToken({ id: 'bob', name: 'Bob ] Jones' })}: see ${mentionToken({ id: 'eve', name: 'Eve' })}`;
        expect(mentionsIn(body)).toEqual(['eve', 'bob']);
        expect(noteParts(body)).toEqual([
            { kind: 'mention', name: 'Eve', user: 'eve' }, { kind: 'text', text: ' and ' }, { kind: 'mention', name: 'Bob   Jones', user: 'bob' },
            { kind: 'text', text: ': see ' }, { kind: 'mention', name: 'Eve', user: 'eve' },
        ]);
        expect(noteParts('plain')).toEqual([{ kind: 'text', text: 'plain' }]);
        expect(mentionsIn('@[Nobody](bad id) @plain @[x](ok_1)')).toEqual(['ok_1']);
        expect(mentionsIn(Array.from({ length: 30 }, (_, index) => `@[U](u${index})`).join(' '))).toHaveLength(NOTE_LIMITS.mentions);
    });
});

describe('note emails', () => {
    it('writes the note as plain text with its quote and a link, for a note and for a reply', () => {
        const body = `Needs a source, ${mentionToken({ id: 'eve', name: 'Eve' })}.`;
        expect(notePlainText(body)).toBe('Needs a source, @Eve.');
        const mail = noteMail({ author: 'Ada', title: 'Shared post', body, quote: 'the cat', url: 'https://example.com/dashboard/content/posts/p1?notes=open', reply: false, site: 'Together' });
        expect(mail.subject).toBe('Ada left you a note on “Shared post”');
        expect(mail.text).toBe(['Ada left a note on “Shared post” (Together):', '', 'On “the cat”:', '', 'Needs a source, @Eve.', '', 'Open the entry\'s notes: https://example.com/dashboard/content/posts/p1?notes=open'].join('\n'));
        const reply = noteMail({ author: 'Eve', title: '  ', body: 'Added one.', quote: '', url: 'https://example.com/x', reply: true, site: '' });
        expect(reply.subject).toBe('Eve replied to a note on “an entry”');
        expect(reply.text).not.toContain('On “');
    });
});

describe('threads and quotes', () => {
    it('groups replies under their root, oldest first, and drops orphans', () => {
        const threads = noteThreads([note('a', null, 1), note('a2', 'a', 3), note('a1', 'a', 2), note('b', null, 4), note('lost', 'gone', 5)]);
        expect(threads.map(thread => [thread.root.id, thread.replies.map(reply => reply.id)])).toEqual([['a', ['a1', 'a2']], ['b', []]]);
    });

    it('finds the occurrence of a quote nearest to where it was', () => {
        const text = 'the cat sat on the mat with the hat';
        expect(findQuote(text, 'the', 0)).toBe(0);
        expect(findQuote(text, 'the', 14)).toBe(15);
        expect(findQuote(text, 'the', 40)).toBe(28);
        expect(findQuote(text, 'dog', 0)).toBe(-1);
        expect(findQuote(text, '', 0)).toBe(-1);
    });
});
