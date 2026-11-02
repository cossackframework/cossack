import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RomeDB } from '@cossackframework/romedb';
import { CmsNetwork, createCMS, isNetworkAdmin, NETWORK_ADMIN, type CmsHost } from '../src/server/index';
import { romedbService, live } from './helpers';

const record = (id: string, userId: string) => ({ id: id.repeat(64).slice(0, 64), userId, kind: 'auth' as const, createdAt: Date.now(), expiresAt: Date.now() + 60_000 });

describe.skipIf(!live)('sign-in handoffs and child sessions', () => {
    const service = romedbService();
    let other: { db: RomeDB; stop(): Promise<void> };
    let network: CmsNetwork;
    let main: CmsHost;
    let blog: CmsHost;
    let user: string;

    /** A network session on the main site; returns its public reference. */
    const signIn = async (token: string, userId: string) => {
        await main.authSessions.create(record(token, userId));
        return (await main.authSessions.publicReference(record(token, userId).id))!;
    };
    /** A child session on the blog from a handoff of this network session. */
    const handOff = async (reference: string, userId: string, token: string) => {
        const handoff = (await network.handoffs.consume(await network.handoffs.issue({ session: reference, user: userId, site: 'blog' }), 'blog'))!;
        await blog.authSessions.createChild(record(token, userId), { parentId: handoff.session, networkRole: handoff.networkRole });
        return record(token, userId).id;
    };

    beforeAll(async () => {
        other = await service.fresh();
        const db = service.database();
        network = new CmsNetwork({
            db, open: () => other.db, networkHost: () => 'example.com',
            host: (_site, siteDb) => createCMS({ db: siteDb, network: db, sessionsEnded: ended => network.endSessions(ended) }),
        });
        main = network.main;
        expect((await main.migrate()).failed).toBeUndefined();
        await network.sites.create({ id: 'blog', name: 'Blog', database: 'blog-db', domains: [{ host: 'blog.example.com' }] });
        blog = network.hostOf((await network.resolve('blog.example.com') as { site: Parameters<CmsNetwork['hostOf']>[0] }).site);
        expect((await blog.migrate()).failed).toBeUndefined();
        await blog.users.defineRole({ id: 'author', name: 'Author', permissions: ['cms:dashboard'] });
        user = (await blog.users.create({ email: 'writer@example.com', name: 'Writer', password: 'writes a lot', roles: ['author'] })).id;
    }, 60_000);

    afterAll(async () => { await other?.stop(); });

    it('trades a code once, for its site, while the network session lives', async () => {
        const reference = await signIn('a', user);
        const code = await network.handoffs.issue({ session: reference, user, site: 'blog' });
        expect(await network.handoffs.consume(code, 'shop')).toBeNull();
        // A wrong site spends the code too.
        expect(await network.handoffs.consume(code, 'blog')).toBeNull();
        const fresh = await network.handoffs.issue({ session: reference, user, site: 'blog' });
        const [first, second] = await Promise.all([network.handoffs.consume(fresh, 'blog'), network.handoffs.consume(fresh, 'blog')]);
        expect([first, second].filter(Boolean)).toEqual([{ session: reference, user, networkRole: null }]);
        expect(await network.handoffs.consume(await network.handoffs.issue({ session: reference, user, site: 'blog', ttlMs: -1 }), 'blog')).toBeNull();
        expect(await network.handoffs.consume('not a code', 'blog')).toBeNull();

        const ended = await network.handoffs.issue({ session: reference, user, site: 'blog' });
        await main.authSessions.revoke(record('a', user).id);
        expect(await network.handoffs.consume(ended, 'blog')).toBeNull();
    });

    it('keeps child sessions in the site database and ends them with their network session', async () => {
        const reference = await signIn('b', user);
        const child = await handOff(reference, user, 'c');
        expect(await blog.authSessions.read(child)).toMatchObject({ userId: user, parentId: reference, networkRole: null });
        expect(await main.authSessions.read(child)).toBeNull();
        expect((await blog.users.resolve(user, { networkRole: null }))!.principal).toMatchObject({ roles: ['author'] });

        await main.authSessions.revoke(record('b', user).id);
        expect(await blog.authSessions.read(child)).toBeNull();
        expect(await network.handoffs.reached({ session: reference })).toEqual([]);
    });

    it('signs a suspended account out of every site, but keeps the session being used', async () => {
        const kept = await signIn('d', user);
        const ended = await signIn('e', user);
        const keptChild = await handOff(kept, user, 'f');
        const endedChild = await handOff(ended, user, 'g');
        await main.authSessions.revokeAllForUser(user, record('d', user).id);
        expect(await blog.authSessions.read(endedChild)).toBeNull();
        expect(await blog.authSessions.read(keptChild)).not.toBeNull();

        await blog.users.setStatus(user, 'disabled');
        expect(await blog.authSessions.read(keptChild)).toBeNull();
        await blog.users.setStatus(user, 'active');
    });

    it('copies a network admin into a site on their first visit, without a role', async () => {
        const admin = (await main.users.create({ email: 'root@example.com', name: 'Root', password: 'runs the network', networkRole: NETWORK_ADMIN })).id;
        expect(await blog.users.get(admin)).toBeNull();
        const handoff = (await network.handoffs.consume(await network.handoffs.issue({ session: await signIn('h', admin), user: admin, site: 'blog' }), 'blog'))!;
        expect(handoff.networkRole).toBe(NETWORK_ADMIN);
        expect(await blog.users.addMember(admin)).toMatchObject({ id: admin, email: 'root@example.com', roles: [] });
        const principal = (await blog.users.resolve(admin, { networkRole: handoff.networkRole }))!.principal;
        expect(isNetworkAdmin(principal)).toBe(true);
        expect(await blog.users.addMember('nobody')).toBeNull();
    });
});
