import { beforeAll, describe, expect, it } from 'vitest';
import { contentModule, createCMS, type CmsHost } from '../src/server/index';
import { mentionToken, NOTE_LIMITS } from '../src/notes';
import { live, romedbService } from './helpers';

describe.skipIf(!live)('notes', () => {
    const service = romedbService();
    let clock = Date.UTC(2026, 10, 5, 9, 0);
    let cms: CmsHost;

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), modules: [contentModule], now: () => clock });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready({ force: true });
    }, 30_000);

    it('keeps threads on an entry: a root with its anchor, replies that mention the people before them, status and activity', async () => {
        const root = await cms.notes.create({ resource: 'cms/posts', recordId: 'p1', userId: 'ada', target: 'text:content:b1.text', range: { from: 3, to: 9 }, quote: 'the cat', body: `Needs a source, ${mentionToken({ id: 'eve', name: 'Eve' })}.` });
        expect(root).toMatchObject({ resource: 'cms/posts', recordId: 'p1', parentId: null, userId: 'ada', target: 'text:content:b1.text', range: { from: 3, to: 9 }, quote: 'the cat', status: 'open', resolvedBy: null, resolvedAt: null, createdAt: clock, updatedAt: clock });
        expect(root.body).toContain('@[Eve](eve)');
        clock += 1000;
        const reply = await cms.notes.create({ resource: 'cms/posts', recordId: 'p1', parentId: root.id, userId: 'eve', body: 'Added one.' });
        // A reply takes the thread's anchor and bumps its activity; its range and quote stay with the root.
        expect(reply).toMatchObject({ parentId: root.id, target: 'text:content:b1.text', range: null, quote: '', status: 'open', createdAt: clock });
        expect((await cms.notes.get(root.id))!.updatedAt).toBe(clock);
        // The root's author hears of the reply; the reply's author of their own mention does not.
        expect((await cms.notes.forUser('ada')).map(note => note.id)).toEqual([root.id]);
        expect((await cms.notes.forUser('eve')).map(note => note.id)).toEqual([root.id]);
        expect(await cms.notes.unseen('ada')).toBe(1);
        expect(await cms.notes.unseen('eve')).toBe(1);
        expect((await cms.notes.forEntry('cms/posts', 'p1')).map(note => note.id)).toEqual([root.id, reply.id]);
        expect(await cms.notes.counts('cms/posts', ['p1', 'p2'])).toEqual(new Map([['p1', 1]]));

        // Opening the entry marks the mentions seen; a second visit writes nothing.
        clock += 1000;
        await cms.notes.markSeen('ada', 'cms/posts', 'p1');
        expect(await cms.notes.unseen('ada')).toBe(0);
        expect(await cms.notes.unseen('eve')).toBe(1);
        await cms.notes.markSeen('ada', 'cms/posts', 'p1');

        // Resolving closes the thread for lists and "for you"; reopening brings it back.
        clock += 1000;
        expect(await cms.notes.setStatus(root.id, 'resolved', 'eve')).toMatchObject({ status: 'resolved', resolvedBy: 'eve', resolvedAt: clock, updatedAt: clock });
        expect(await cms.notes.counts('cms/posts', ['p1'])).toEqual(new Map());
        expect(await cms.notes.forUser('ada')).toEqual([]);
        expect(await cms.notes.unseen('eve')).toBe(0);
        expect(await cms.notes.setStatus(reply.id, 'resolved', 'eve')).toBeNull();
        expect(await cms.notes.setStatus(root.id, 'open', 'eve')).toMatchObject({ status: 'open', resolvedBy: null, resolvedAt: null });
        expect(await cms.notes.counts('cms/posts', ['p1'])).toEqual(new Map([['p1', 1]]));

        // An edit changes the text, bumps the thread and mentions the newcomer once.
        clock += 1000;
        const edited = await cms.notes.edit(reply.id, `Added one, ${mentionToken({ id: 'bob', name: 'Bob' })} ${mentionToken({ id: 'ada', name: 'Ada' })}.`);
        expect(edited!.body).toContain('@[Bob](bob)');
        expect((await cms.notes.get(root.id))!.updatedAt).toBe(clock);
        expect((await cms.notes.forUser('bob')).map(note => note.id)).toEqual([root.id]);
        expect(await cms.notes.unseen('bob')).toBe(1);
        // Ada, told of the reply once and having seen it, is not told of the same reply twice.
        expect(await cms.notes.unseen('ada')).toBe(0);

        // The passage moved: the root's range follows; a reply has none to move.
        await cms.notes.move([{ id: root.id, range: { from: 10, to: 16 } }, { id: reply.id, range: { from: 1, to: 2 } }, { id: 'missing', range: { from: 0, to: 1 } }]);
        expect((await cms.notes.get(root.id))!.range).toEqual({ from: 10, to: 16 });
        expect((await cms.notes.get(reply.id))!.range).toBeNull();

        // Removing a reply leaves the thread; removing the root takes everything with it.
        expect(await cms.notes.remove(reply.id)).toBe(true);
        expect((await cms.notes.forEntry('cms/posts', 'p1')).map(note => note.id)).toEqual([root.id]);
        expect(await cms.notes.remove(root.id)).toBe(true);
        expect(await cms.notes.forEntry('cms/posts', 'p1')).toEqual([]);
        expect(await cms.notes.unseen('bob')).toBe(0);
        expect(await cms.notes.remove(root.id)).toBe(false);
    });

    it('refuses what it cannot place or hold', async () => {
        await expect(cms.notes.create({ resource: 'cms/posts', recordId: 'p1', userId: 'ada', target: 'somewhere', body: 'x' })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(cms.notes.create({ resource: 'cms/posts', recordId: 'p1', userId: 'ada', target: 'entry', body: '  ' })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(cms.notes.create({ resource: 'cms/posts', recordId: 'p 1', userId: 'ada', target: 'entry', body: 'x' })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(cms.notes.create({ resource: 'cms/posts', recordId: 'p1', parentId: 'missing', userId: 'ada', body: 'x' })).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        // A reply in another entry's thread is refused.
        const root = await cms.notes.create({ resource: 'cms/posts', recordId: 'p3', userId: 'ada', target: 'field:title', body: 'Shorter?' });
        await expect(cms.notes.create({ resource: 'cms/posts', recordId: 'p4', parentId: root.id, userId: 'eve', body: 'x' })).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        // A note on a field keeps no range or quote.
        expect(root).toMatchObject({ range: null, quote: '' });
        expect(await cms.notes.edit('missing', 'x')).toBeNull();
        expect(await cms.notes.get('../x')).toBeNull();
    });

    it('lists the entries that hold notes and purges one that is gone', async () => {
        await cms.notes.create({ resource: 'cms/pages', recordId: 'gone', userId: 'ada', target: 'entry', body: `For ${mentionToken({ id: 'eve', name: 'Eve' })}` });
        expect(await cms.notes.entries()).toEqual(expect.arrayContaining([{ resource: 'cms/pages', recordId: 'gone' }, { resource: 'cms/posts', recordId: 'p3' }]));
        expect(await cms.notes.unseen('eve')).toBe(1);
        await cms.notes.purgeEntry('cms/pages', 'gone');
        expect(await cms.notes.forEntry('cms/pages', 'gone')).toEqual([]);
        expect(await cms.notes.unseen('eve')).toBe(0);
        expect((await cms.notes.entries()).some(entry => entry.recordId === 'gone')).toBe(false);
    });

    it('caps an entry at the limit', async () => {
        for (let from = 0; from < NOTE_LIMITS.perEntry; from += 25) {
            await Promise.all(Array.from({ length: Math.min(25, NOTE_LIMITS.perEntry - from) }, (_, index) => cms.notes.create({ resource: 'cms/posts', recordId: 'full', userId: 'ada', target: 'entry', body: `Note ${from + index}` })));
        }
        await expect(cms.notes.create({ resource: 'cms/posts', recordId: 'full', userId: 'ada', target: 'entry', body: 'One more' })).rejects.toMatchObject({ code: 'CMS_LIMIT' });
    }, 120_000);
});
