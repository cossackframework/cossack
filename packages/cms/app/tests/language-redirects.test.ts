import { beforeAll, describe, expect, it, vi } from 'vitest';
import { contentModule, createCMS, type CmsHost, type Principal } from '../../src/server/index';
import { live, romedbService } from '../../tests/helpers';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('__', (text: string) => text);
const { redirectFor } = await import('../src/cms/site');

const admin: Principal = { kind: 'user', id: 'admin-1', roles: ['admin'], permissions: ['*'] };

describe.skipIf(!live)('redirects under language prefixes', () => {
    const service = romedbService();
    let cms: CmsHost;
    beforeAll(async () => {
        cms = createCMS({ db: service.database(), modules: [contentModule] });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready({ force: true });
    }, 30_000);

    it('sends a moved collection\'s old links in every language to the new path, keeping the language', async () => {
        await cms.saveLanguages({ default: 'en', others: ['fr'] }, admin);
        const before = cms.collection('posts').path;
        await cms.saveCollection({ ...cms.collection('posts'), path: 'news' }, admin);
        for (let round = 0; round < 3; round++) await cms.outbox.dispatch({ limit: 100 });
        const hits: Promise<unknown>[] = [];
        const resolve = (path: string) => redirectFor(cms, path, '', work => { hits.push(work); });
        expect(await resolve(`/${before}/hello`)).toMatchObject({ kind: 'redirect', url: '/news/hello' });
        expect(await resolve(`/fr/${before}/bonjour`)).toMatchObject({ kind: 'redirect', url: '/fr/news/bonjour' });
        // A prefix that is not a language finds nothing.
        expect(await resolve(`/xx/${before}/hello`)).toBeNull();
        await Promise.all(hits);
    });
});
