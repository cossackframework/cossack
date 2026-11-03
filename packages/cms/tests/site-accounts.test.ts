import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RomeDB } from '@cossackframework/romedb';
import { CmsNetwork, createCMS, DEFAULT_ROLES, NETWORK_ADMIN, systemPrincipal, type CmsHost } from '../src/server/index';
import { romedbService, live } from './helpers';

const record = (id: string, userId: string) => ({ id: id.repeat(64).slice(0, 64), userId, kind: 'auth' as const, createdAt: Date.now(), expiresAt: Date.now() + 60_000 });

describe.skipIf(!live)('site accounts: people who sign in on one added site only', () => {
    const service = romedbService();
    let other: { db: RomeDB; stop(): Promise<void> };
    let network: CmsNetwork;
    let main: CmsHost;
    let blog: CmsHost;
    let owner: string;

    beforeAll(async () => {
        other = await service.fresh();
        const db = service.database();
        network = new CmsNetwork({
            db, open: () => other.db, networkHost: () => 'example.com',
            host: (site, siteDb) => createCMS({ db: siteDb, network: db, site: site.id, sessionsEnded: ended => network.endSessions(ended) }),
        });
        main = network.main;
        expect((await main.migrate()).failed).toBeUndefined();
        await network.setEnabled(true, { principal: systemPrincipal('tests') });
        await network.sites.create({ id: 'blog', name: 'Blog', database: 'blog-db', domains: [{ host: 'blog.example.com' }] });
        blog = network.hostOf((await network.resolve('blog.example.com') as { site: Parameters<CmsNetwork['hostOf']>[0] }).site);
        expect((await blog.migrate()).failed).toBeUndefined();
        for (const role of DEFAULT_ROLES) await blog.users.defineRole({ ...role, permissions: [...role.permissions] });
        owner = (await main.users.create({ email: 'owner@example.com', name: 'Owner', password: 'owns the place', roles: ['admin'], networkRole: NETWORK_ADMIN })).id;
    }, 60_000);

    afterAll(async () => { await other?.stop(); });

    it('keeps the main site on network accounts', async () => {
        expect(main.siteAccounts).toBeNull();
        expect(main.signIn.kind).toBe('network');
        expect((await main.users.get(owner))?.account).toBe('network');
        expect(await main.accounts.hasNetworkAdmin()).toBe(true);
    });

    it('creates site accounts on an added site, in its own database, outside the network', async () => {
        const reader = await blog.users.create({ email: 'thanh@example.com', name: 'Thanh', password: 'reads a lot', roles: ['subscriber'] });
        expect(reader.account).toBe('site');
        expect(await main.accounts.findByEmail('thanh@example.com')).toBeNull();
        expect((await main.accounts.memberships([reader.id])).get(reader.id)).toEqual([]);
        expect((await main.accounts.list({ search: 'thanh' })).total).toBe(0);
        expect((await blog.siteAccounts!.verifier.verify('thanh@example.com', 'reads a lot'))?.id).toBe(reader.id);
        expect(await main.accounts.verifier.verify('thanh@example.com', 'reads a lot')).toBeNull();
        expect(await blog.users.resolve(reader.id)).toMatchObject({ principal: { kind: 'user', roles: ['subscriber'] } });
        expect(blog.signIn.kind).toBe('site');
        expect((await blog.storesOf(reader.id)).kind).toBe('site');
        await expect(blog.users.create({ email: 'Thanh@Example.com', name: 'Again', password: 'reads a lot' })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        await expect(blog.users.create({ email: 'boss@example.com', name: 'Boss', password: 'runs things', networkRole: NETWORK_ADMIN })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        // A network account elsewhere does not take the email on this site.
        await main.users.create({ email: 'shared@example.com', name: 'Network Shared', password: 'shared one' });
        expect((await blog.users.create({ email: 'shared@example.com', name: 'Site Shared', password: 'shared two' })).account).toBe('site');
    });

    it('still adds network accounts to an added site when asked', async () => {
        const editor = await blog.users.create({ email: 'editor@example.com', name: 'Editor', password: 'edits daily', roles: ['editor'], network: true });
        expect(editor.account).toBe('network');
        expect((await main.accounts.memberships([editor.id])).get(editor.id)).toEqual(['blog']);
        expect((await blog.storesOf(editor.id)).kind).toBe('network');
        expect((await blog.users.list()).items.map(user => [user.email, user.account])).toEqual(expect.arrayContaining([['editor@example.com', 'network'], ['thanh@example.com', 'site']]));
        // Removing a network account from the site keeps the account.
        expect(await blog.users.delete(editor.id)).toBe(true);
        expect(await main.accounts.get(editor.id)).not.toBeNull();
    });

    it('changes, suspends and deletes a site account on the site alone', async () => {
        const reader = (await blog.users.findByEmail('thanh@example.com'))!;
        expect(await blog.users.update(reader.id, { name: 'Thanh N.', email: 'thanh.n@example.com' })).toBe(true);
        expect(await blog.siteAccounts!.get(reader.id)).toMatchObject({ name: 'Thanh N.', email: 'thanh.n@example.com' });
        expect(await blog.users.setPassword(reader.id, 'a new password')).toBe(true);
        expect((await blog.siteAccounts!.verifier.verify('thanh.n@example.com', 'a new password'))?.id).toBe(reader.id);

        await blog.authSessions.create(record('s', reader.id));
        expect(await blog.users.setStatus(reader.id, 'disabled')).toBe(true);
        expect(await blog.users.resolve(reader.id)).toBeNull();
        expect(await blog.authSessions.read(record('s', reader.id).id)).toBeNull();
        await blog.users.setStatus(reader.id, 'active');

        // Its application passwords are the site's.
        const { token } = await blog.siteApiTokens!.create(reader.id, { name: 'Reader app', scope: 'read' });
        expect(await blog.tokenPrincipal(token)).toMatchObject({ userId: reader.id, scope: 'read' });
        expect(await main.tokenPrincipal(token)).toBeNull();

        expect(await blog.users.delete(reader.id)).toBe(true);
        expect(await blog.siteAccounts!.get(reader.id)).toBeNull();
        expect(await blog.tokenPrincipal(token)).toBeNull();
    });

    it('moves site accounts with the database: a takeover keeps their passwords', async () => {
        const writer = await blog.users.create({ email: 'writer@example.com', name: 'Writer', password: 'writes daily', roles: ['author'] });
        await blog.users.addMember(owner, { roles: ['admin'] });
        const standalone = createCMS({ db: blog.db });
        expect(await standalone.accounts.hasNetworkAdmin()).toBe(false);
        expect(await standalone.accounts.adoptMembers('main', owner, 'the new owner')).toBe(1);
        expect(await standalone.accounts.hasNetworkAdmin()).toBe(true);
        expect((await standalone.accounts.verifier.verify('writer@example.com', 'writes daily'))?.id).toBe(writer.id);
        expect((await standalone.accounts.verifier.verify('owner@example.com', 'the new owner'))?.id).toBe(owner);
    });
});
