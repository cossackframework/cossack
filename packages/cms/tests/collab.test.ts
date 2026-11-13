import { beforeAll, describe, expect, it } from 'vitest';
import { contentModule, createCMS, saveBytes, type CmsHost, type Principal } from '../src/server/index';
import { live, romedbService } from './helpers';

describe.skipIf(!live)('shared drafts', () => {
    const service = romedbService();
    let clock = Date.UTC(2026, 10, 5, 9, 0);
    let cms: CmsHost;

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), modules: [contentModule], now: () => clock });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready({ force: true });
    }, 30_000);

    it('keeps one draft per entry with its versions and editors', async () => {
        expect(await cms.drafts.get('cms/posts', 'p1')).toBeNull();
        const at = await cms.drafts.save('cms/posts', 'p1', { baseRev: 3, values: { title: 'Together' }, versions: { body: 12 }, editors: ['alice', 'bob', 'alice'] });
        expect(at).toBe(clock);
        expect(await cms.drafts.get('cms/posts', 'p1')).toEqual({ baseRev: 3, values: { title: 'Together' }, versions: { body: 12 }, editors: ['alice', 'bob'], at: clock });
        clock += 1000;
        await cms.drafts.save('cms/posts', 'p1', { baseRev: 4, values: { title: 'Together, longer' }, versions: { body: 15 }, editors: ['alice'] });
        expect(await cms.drafts.get('cms/posts', 'p1')).toMatchObject({ baseRev: 4, values: { title: 'Together, longer' }, versions: { body: 15 }, editors: ['alice'], at: clock });
        expect(await cms.drafts.get('cms/pages', 'p1')).toBeNull();
        await cms.drafts.discard('cms/posts', 'p1');
        expect(await cms.drafts.get('cms/posts', 'p1')).toBeNull();
    });

    it('refuses drafts a RomeDB request cannot carry, and bad entry IDs', async () => {
        await expect(cms.drafts.save('cms/posts', 'p2', { baseRev: 1, values: { body: 'x'.repeat(65_536) }, versions: {}, editors: [] })).rejects.toMatchObject({ code: 'CMS_LIMIT' });
        // Counted in UTF-8 bytes as the request carries them: 6 000 three-byte characters are 18 000 bytes,
        // over what an entry can hold and still be saved in a 64 KiB request.
        await expect(cms.drafts.save('cms/posts', 'p2', { baseRev: 1, values: { body: '€'.repeat(6_000) }, versions: {}, editors: [] })).rejects.toMatchObject({ code: 'CMS_LIMIT' });
        await expect(cms.autosaves.save('cms/posts', 'p2', 'alice', { body: '€'.repeat(6_000) })).rejects.toMatchObject({ code: 'CMS_LIMIT' });
        await cms.drafts.save('cms/posts', 'p2', { baseRev: 1, values: { body: '€'.repeat(3_000) }, versions: {}, editors: [] });
        await expect(cms.drafts.save('cms/posts', 'p 2', { baseRev: 1, values: {}, versions: {}, editors: [] })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(cms.drafts.save('cms/posts', 'p2', { baseRev: -1, values: {}, versions: {}, editors: [] })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(cms.drafts.get('cms/posts', '../p2')).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });

    it('takes the largest draft whose entry still saves, for plain, rich and densely formatted text', async () => {
        const admin: Principal = { kind: 'user', id: 'admin-1', roles: ['admin'], permissions: ['*'] };
        const marked = (i: number) => ({ type: 'paragraph', content: [{ type: 'text', text: `Lorem "ipsum" dolor sit amet ${i} ` }, { type: 'text', marks: [{ type: 'bold' }], text: 'bold' }, { type: 'text', marks: [{ type: 'link', attrs: { href: 'https://example.com/a' } }], text: 'link' }] });
        const dense = () => ({ type: 'paragraph', content: Array.from({ length: 10 }, (_, j) => ({ type: 'text', marks: [{ type: j % 2 ? 'bold' : 'italic' }], text: String.fromCharCode(97 + j) })) });
        const shapes: { [name: string]: (n: number) => unknown[] } = {
            paragraphs: n => Array.from({ length: n }, (_, i) => ({ _id: `p${i}`, type: 'core/paragraph', data: { text: `Lorem "ipsum" dolor sit amet, consectetur ${i}. `.repeat(8) } })),
            rich: n => [{ _id: 'r', type: 'core/richtext', data: { text: { type: 'doc', content: Array.from({ length: n }, (_, i) => marked(i)) } } }],
            dense: n => [{ _id: 'r', type: 'core/richtext', data: { text: { type: 'doc', content: Array.from({ length: n }, dense) } } }],
        };
        const posts = cms.resource('cms/posts');
        for (const [name, shape] of Object.entries(shapes)) {
            let n = 1;
            while (saveBytes({ title: name, content: shape(n + 1) }) <= 65_536 && n < 200) n++;
            const values = { title: name, content: shape(n) };
            // The largest draft the cap takes saves as an entry; one paragraph more is refused.
            await cms.drafts.save('cms/posts', `cap-${name}`, { baseRev: 1, values, versions: {}, editors: [] });
            const post = await posts.create({ title: name }, { principal: admin });
            expect((await posts.update(post.id, values, { principal: admin, expectedRevision: post.rev })).content).toHaveLength(shape(n).length);
            await expect(cms.drafts.save('cms/posts', `cap-${name}`, { baseRev: 1, values: { title: name, content: shape(n + 1) }, versions: {}, editors: [] })).rejects.toMatchObject({ code: 'CMS_LIMIT' });
        }
    });

    it('reports who is editing which entries within the window, without a draft of values', async () => {
        await cms.drafts.editing('cms/posts', 'a', ['alice']);
        await cms.drafts.editing('cms/posts', 'b', ['bob', 'carol']);
        await cms.drafts.editing('cms/pages', 'a', ['dave']);
        expect(await cms.drafts.get('cms/posts', 'a')).toMatchObject({ baseRev: 0, values: {}, editors: ['alice'], at: 0 });
        expect(await cms.drafts.editors('cms/posts', ['a', 'b', 'c'])).toEqual(new Map([['a', ['alice']], ['b', ['bob', 'carol']]]));
        expect(await cms.drafts.editors('cms/posts', [])).toEqual(new Map());
        // Rooms report their editors as they go; an empty room names nobody.
        await cms.drafts.editing('cms/posts', 'b', []);
        expect(await cms.drafts.editors('cms/posts', ['a', 'b'])).toEqual(new Map([['a', ['alice']]]));
        // The window closes on a room that stopped reporting.
        clock += 2 * 60_000;
        expect(await cms.drafts.editors('cms/posts', ['a'])).toEqual(new Map());
        // A draft saved later keeps the editors it names.
        await cms.drafts.save('cms/posts', 'a', { baseRev: 1, values: { title: 'A' }, versions: {}, editors: ['alice', 'erin'] });
        expect(await cms.drafts.editors('cms/posts', ['a'])).toEqual(new Map([['a', ['alice', 'erin']]]));
    });

    it('purges drafts and presence rows untouched for a month', async () => {
        await cms.drafts.save('cms/posts', 'old', { baseRev: 1, values: { title: 'Old' }, versions: {}, editors: [] });
        clock += 31 * 24 * 60 * 60 * 1000;
        await cms.drafts.save('cms/posts', 'fresh', { baseRev: 1, values: { title: 'Fresh' }, versions: {}, editors: [] });
        await cms.drafts.purge();
        expect(await cms.drafts.get('cms/posts', 'old')).toBeNull();
        expect(await cms.drafts.get('cms/posts', 'fresh')).not.toBeNull();
    });
});
