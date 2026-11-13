import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RomeDB } from '@cossackframework/romedb';
import { CmsHandoffs, CmsNetwork, createCMS, isNetworkAdmin, NETWORK_ADMIN, systemPrincipal, type CmsHost } from '../src/server/index';
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
        await blog.authSessions.createChild(record(token, userId), { parentId: handoff.session, networkRole: handoff.networkRole, expiresAt: handoff.expiresAt });
        return record(token, userId).id;
    };

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
        await blog.users.defineRole({ id: 'author', name: 'Author', permissions: ['cms:dashboard'] });
        user = (await blog.users.create({ email: 'writer@example.com', name: 'Writer', password: 'writes a lot', roles: ['author'], network: true })).id;
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
        expect([first, second].filter(Boolean)).toEqual([{ session: reference, user, networkRole: null, expiresAt: expect.any(Number), secondFactor: false }]);
        expect(await network.handoffs.consume(await network.handoffs.issue({ session: reference, user, site: 'blog', ttlMs: -1 }), 'blog')).toBeNull();
        expect(await network.handoffs.consume('not a code', 'blog')).toBeNull();

        const ended = await network.handoffs.issue({ session: reference, user, site: 'blog' });
        await main.authSessions.revoke(record('a', user).id);
        expect(await network.handoffs.consume(ended, 'blog')).toBeNull();
    });

    it('records no site for a network session signed out while its code is traded', async () => {
        const reference = await signIn('r', user);
        // The sign-out lands between the handoff's read and its write.
        const db = service.database();
        let signedOut = false;
        const racing = new Proxy(db, {
            get(target, property) {
                if (property === 'read') return async (...args: Parameters<RomeDB['read']>) => {
                    const result = await target.read(...args);
                    if (!signedOut) { signedOut = true; await main.authSessions.revoke(record('r', user).id); }
                    return result;
                };
                const value = Reflect.get(target, property, target) as unknown;
                return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
            },
        });
        const handoffs = new CmsHandoffs(racing);
        expect(await handoffs.consume(await handoffs.issue({ session: reference, user, site: 'blog' }), 'blog')).toBeNull();
        expect(await network.handoffs.reached({ session: reference })).toEqual([]);
    });

    it('records whether a sign-in used a second factor, carries it through a handoff and keeps it across rotation', async () => {
        // A password-only network session hands off a child session that did not use one either.
        const plain = await signIn('n', user);
        const plainHandoff = (await network.handoffs.consume(await network.handoffs.issue({ session: plain, user, site: 'blog' }), 'blog'))!;
        expect(plainHandoff.secondFactor).toBe(false);
        await blog.authSessions.createChild(record('o', user), { parentId: plainHandoff.session, networkRole: plainHandoff.networkRole, expiresAt: plainHandoff.expiresAt, secondFactor: plainHandoff.secondFactor });
        expect((await blog.authSessions.read(record('o', user).id))!.secondFactor).toBe(false);
        // One signed in with a code hands that on.
        await main.authSessions.create(record('p', user), undefined, { secondFactor: true });
        const verified = (await main.authSessions.publicReference(record('p', user).id))!;
        const handoff = (await network.handoffs.consume(await network.handoffs.issue({ session: verified, user, site: 'blog' }), 'blog'))!;
        expect(handoff.secondFactor).toBe(true);
        await blog.authSessions.createChild(record('q', user), { parentId: handoff.session, networkRole: handoff.networkRole, expiresAt: handoff.expiresAt, secondFactor: handoff.secondFactor });
        const child = (await blog.authSessions.read(record('q', user).id))!;
        expect(child.secondFactor).toBe(true);
        const rotated = record('r', user);
        expect(await blog.authSessions.replace(child, rotated, Date.now())).toBe(true);
        expect((await blog.authSessions.read(rotated.id))!.secondFactor).toBe(true);
        expect((await blog.authSessions.findByReference((await blog.authSessions.publicReference(rotated.id))!))!.secondFactor).toBe(true);
        // A factor added in a session marks that session only.
        expect(await blog.authSessions.markSecondFactor(record('o', user).id)).toBe(true);
        expect((await blog.authSessions.read(record('o', user).id))!.secondFactor).toBe(true);
        expect(await blog.authSessions.markSecondFactor('missing')).toBe(false);
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

    it('ends a child session no later than its network session, also after rotation', async () => {
        const parent = { ...record('i', user), expiresAt: Date.now() + 30_000 };
        await main.authSessions.create(parent);
        const reference = (await main.authSessions.publicReference(parent.id))!;
        const handoff = (await network.handoffs.consume(await network.handoffs.issue({ session: reference, user, site: 'blog' }), 'blog'))!;
        expect(handoff.expiresAt).toBe(parent.expiresAt);
        const child = { ...record('j', user), expiresAt: Date.now() + 3_600_000 };
        await blog.authSessions.createChild(child, { parentId: handoff.session, networkRole: handoff.networkRole, expiresAt: handoff.expiresAt });
        const stored = (await blog.authSessions.read(child.id))!;
        expect(stored.expiresAt).toBe(parent.expiresAt);
        const rotated = { ...record('k', user), expiresAt: Date.now() + 3_600_000 };
        expect(await blog.authSessions.replace(stored, rotated, Date.now())).toBe(true);
        expect((await blog.authSessions.read(rotated.id))!.expiresAt).toBe(parent.expiresAt);
        // A network session still rotates to a later expiry.
        const later = { ...record('l', user), expiresAt: Date.now() + 3_600_000 };
        expect(await main.authSessions.replace((await main.authSessions.read(parent.id))!, later, Date.now())).toBe(true);
        expect((await main.authSessions.read(later.id))!.expiresAt).toBe(later.expiresAt);
        await expect(blog.authSessions.createChild(record('m', user), { parentId: handoff.session, networkRole: null, expiresAt: Date.now() - 1 })).rejects.toThrow();
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
