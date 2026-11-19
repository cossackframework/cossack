import { beforeAll, describe, expect, it } from 'vitest';
import type { RomeDB } from '@cossackframework/romedb';
import { contentModule, createCMS, DEFAULT_ROLES, type CmsHost } from '../src/server/index';
import { live, romedbService } from './helpers';

/**
 * Each read is a round trip to the database: on RomeDB Cloud it costs the network's latency. What
 * a page needs and can know up front is read side by side, so a page waits about one round trip
 * for it, not one per read. Every read here is slowed down, so reads that waited on each other
 * would never overlap.
 */
function overlapping(db: RomeDB): { db: RomeDB; most(): number; reset(): void } {
    let running = 0;
    let most = 0;
    const wrapped = new Proxy(db, {
        get(target, property) {
            if (property === 'read') return async (...args: Parameters<RomeDB['read']>) => {
                running++; most = Math.max(most, running);
                try {
                    await new Promise(done => setTimeout(done, 20));
                    return await target.read(...args);
                } finally { running--; }
            };
            const value = Reflect.get(target, property, target) as unknown;
            return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
    });
    return { db: wrapped, most: () => most, reset: () => { most = 0; } };
}

describe.skipIf(!live)('round trips', () => {
    const service = romedbService();
    let cms: CmsHost;
    let reads: ReturnType<typeof overlapping>;
    let clock = Date.UTC(2026, 10, 13, 9, 0);

    beforeAll(async () => {
        reads = overlapping(service.database());
        cms = createCMS({ db: reads.db, modules: [contentModule], now: () => clock });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready({ force: true });
        for (const role of DEFAULT_ROLES) await cms.users.defineRole({ ...role, permissions: [...role.permissions] });
    }, 60_000);

    it('reads users beside their roles', async () => {
        const ada = await cms.users.create({ email: 'ada@example.com', name: 'Ada', roles: ['editor', 'author'] });
        const bob = await cms.users.create({ email: 'bob@example.com', name: 'Bob', roles: ['editor'] });
        reads.reset();
        const found = await cms.users.getMany([ada.id, bob.id, 'nobody']);
        expect(reads.most()).toBe(3);
        expect([...found.keys()].sort()).toEqual([ada.id, bob.id].sort());
        expect(found.get(ada.id)!.roles).toEqual(['author', 'editor']);
        expect(found.get(bob.id)!.assignments.map(role => role.id)).toEqual(['editor']);
        expect(found.get(bob.id)!.permissions).toContain('cms:media');
        expect(found.get(ada.id)!.permissions).toContain('cms/posts:create');
        // A user without roles has none, and no role is read for them.
        const carol = await cms.users.create({ email: 'carol@example.com', name: 'Carol', roles: [] });
        expect((await cms.users.getMany([carol.id])).get(carol.id)).toMatchObject({ roles: [], permissions: [] });
    });

    it('reloads the site definitions with its reads side by side', async () => {
        clock += 60_000;
        reads.reset();
        await cms.ready();
        // Collections and taxonomies in one request, beside the field groups: each read in flight takes one of
        // the client's 32 places, which every request of the isolate shares. The plugins' activation and the
        // settings are read by the steps that need them: started beside these, they stopped a Worker from answering.
        expect(reads.most()).toBe(2);
        expect(cms.collections().map(collection => collection.name)).toContain('posts');
    });
});
