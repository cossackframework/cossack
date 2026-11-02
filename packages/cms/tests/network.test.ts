import { beforeAll, describe, expect, it } from 'vitest';
import type { RomeDB } from '@cossackframework/romedb';
import type { StorageProvider } from '@cossackframework/core/storage';
import { CmsNetwork, createCMS, MAIN, prefixedStorage, siteHost, type CmsHost, type NetworkSite } from '../src/server/index';
import { romedbService, live } from './helpers';

function memoryStorage(): StorageProvider & { objects: Map<string, Uint8Array> } {
    const objects = new Map<string, Uint8Array>();
    return {
        name: 'memory', objects,
        async put(key, body, options) { objects.set(key, new Uint8Array(await new Response(body).arrayBuffer())); return { key, size: options.size }; },
        async get(key) { const bytes = objects.get(key); return bytes ? { key, size: bytes.length, body: new Response(bytes.slice().buffer as ArrayBuffer).body! } : null; },
        async head(key) { const bytes = objects.get(key); return bytes ? { key, size: bytes.length } : null; },
        async delete(key) { objects.delete(key); },
    };
}

/** A host stand-in: the network only builds hosts and closes their databases. */
const stubHost = (site: NetworkSite, db: RomeDB) => ({ site: site.id, db }) as unknown as CmsHost;

describe('site hosts and media keys', () => {
    it('normalizes hosts the way the registry stores them', () => {
        expect(siteHost('Blog.Example.COM:8443')).toBe('blog.example.com');
        expect(siteHost('example.com.')).toBe('example.com');
        expect(siteHost('localhost:5173')).toBe('localhost');
        expect(siteHost('bad host')).toBe('');
        expect(siteHost('-x.example.com')).toBe('');
    });

    it('keeps the hosts used last and never drops the main site', () => {
        const closed: string[] = [];
        const open = (site: NetworkSite) => ({ close: async () => { closed.push(site.database); } }) as unknown as RomeDB;
        const network = new CmsNetwork({ db: { close: async () => {} } as unknown as RomeDB, open, host: stubHost, maxHosts: 2 });
        const site = (id: string): NetworkSite => ({ id, name: id, database: `db-${id}`, status: 'active', host: `${id}.example.com` });
        const main = network.main;
        const a = network.hostOf(site('a'));
        expect(network.hostOf(site('a'))).toBe(a);
        network.hostOf(site('b'));
        expect(network.main).toBe(main);
        // Three hosts with room for two: `a`, used longest ago, goes; the main site stays.
        expect(network.hostOf(site('a'))).not.toBe(a);
    });

    it('needs a database provider for added sites', () => {
        const network = new CmsNetwork({ db: {} as RomeDB, host: stubHost });
        expect(network.multisite).toBe(false);
        expect(() => network.hostOf({ ...MAIN, id: 'blog', database: 'db-blog' })).toThrow(/provider/);
    });

    it('keeps a site\'s media under its prefix', async () => {
        const storage = memoryStorage();
        const site = prefixedStorage(storage, 'sites/blog/');
        expect(await site.put('cms/files/1', new Response('hi').body!, { size: 2, contentType: 'text/plain' })).toMatchObject({ key: 'cms/files/1' });
        expect([...storage.objects.keys()]).toEqual(['sites/blog/cms/files/1']);
        expect(await site.head('cms/files/1')).toMatchObject({ key: 'cms/files/1', size: 2 });
        expect(await prefixedStorage(storage, 'sites/other/').get('cms/files/1')).toBeNull();
        await site.delete('cms/files/1');
        expect(storage.objects.size).toBe(0);
        expect(() => prefixedStorage(storage, '../up/')).toThrow(TypeError);
    });
});

describe.skipIf(!live)('site registry and host resolution', () => {
    const service = romedbService();
    let main: CmsHost;
    let network: CmsNetwork;
    let now = 1_000;

    beforeAll(async () => {
        main = createCMS({ db: service.database() });
        expect((await main.migrate()).failed).toBeUndefined();
        network = new CmsNetwork({ db: main.db, open: () => ({ close: async () => {} }) as unknown as RomeDB, host: stubHost, networkHost: () => 'example.com:5173', now: () => now });
    });

    it('serves the main site on every host while it is the only site', async () => {
        expect(await network.resolve('anything.test')).toEqual({ kind: 'site', site: MAIN });
        expect(await new CmsNetwork({ db: main.db, host: stubHost }).resolve('preview.example.net')).toEqual({ kind: 'site', site: MAIN });
    });

    it('registers sites with their domains, and refuses a domain another site has', async () => {
        const blog = await network.sites.create({ id: 'blog', name: 'Blog', database: 'db-blog', domains: [{ host: 'blog.example.com' }, { host: 'Blog.Example.Org' }] });
        expect(blog).toMatchObject({ id: 'blog', status: 'active', domains: [{ host: 'blog.example.com', primary: true }, { host: 'blog.example.org', primary: false }] });
        await expect(network.sites.create({ id: 'copy', name: 'Copy', database: 'db-copy', domains: [{ host: 'blog.example.org' }] })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        expect(await network.sites.get('copy')).toBeNull();
        await expect(network.sites.create({ id: 'main', name: 'Main', database: 'db-main', domains: [{ host: 'main.example.com' }] })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await network.sites.create({ id: 'shop', name: 'Shop', database: 'db-shop', domains: [{ host: 'shop.example.com' }] });
        await network.sites.create({ id: 'old', name: 'Old', database: 'db-old', status: 'archived', domains: [{ host: 'old.example.com' }] });
        expect((await network.sites.list({ search: 'example.org' })).items.map(site => site.id)).toEqual(['blog']);
        expect((await network.sites.list()).total).toBe(3);
    });

    it('resolves hosts to sites, aliases to their primary domain, and unknown hosts to nothing', async () => {
        // The lookups above were cached while the network had one site.
        expect(await network.resolve('blog.example.com')).toEqual({ kind: 'site', site: MAIN });
        network.invalidate();
        expect(await network.resolve('Blog.Example.com:5173')).toMatchObject({ kind: 'site', site: { id: 'blog', database: 'db-blog', host: 'blog.example.com' } });
        expect(await network.resolve('blog.example.org')).toEqual({ kind: 'redirect', host: 'blog.example.com', site: 'blog' });
        expect(await network.resolve('example.com')).toEqual({ kind: 'site', site: MAIN });
        expect(await network.resolve('nobody.example.com')).toEqual({ kind: 'missing' });
        expect(await network.resolve('old.example.com')).toMatchObject({ kind: 'archived', site: { id: 'old' } });
        expect(network.hostOf((await network.resolve('blog.example.com') as { site: NetworkSite }).site)).toMatchObject({ site: 'blog' });
    });

    it('stops serving a deleted site and records when it went', async () => {
        now = 5_000;
        expect(await network.sites.update('shop', { status: 'deleted' })).toMatchObject({ status: 'deleted', deletedAt: 5_000 });
        network.invalidate();
        expect(await network.resolve('shop.example.com')).toEqual({ kind: 'missing' });
        expect(await network.sites.update('shop', { status: 'active' })).toMatchObject({ status: 'active', deletedAt: null });
    });

    it('visits sites in turn for scheduled work', async () => {
        expect((await network.sites.inTurn('')).map(site => site.id)).toEqual(['blog', 'old', 'shop']);
        expect((await network.sites.inTurn('blog')).map(site => site.id)).toEqual(['old', 'shop', 'blog']);
        await network.sites.update('old', { status: 'deleted' });
        expect((await network.sites.inTurn('shop')).map(site => site.id)).toEqual(['blog', 'shop']);
    });
});
