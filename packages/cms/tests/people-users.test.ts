import { beforeAll, describe, expect, it } from 'vitest';
import { contentModule, createCMS, DEFAULT_ROLES, memoryPeople, type Block, type CmsHost, type Principal } from '../src/server/index';
import { romedbService, live } from './helpers';

const admin: Principal = { kind: 'user', id: 'admin-1', roles: ['admin'], permissions: ['*'] };
const fieldBlock = (id: string, kind: string, data: { [key: string]: unknown }): Block => ({ _id: id, type: `field/${kind}`, data: { label: id, ...data } });

describe.skipIf(!live)('users over the people port', () => {
    const service = romedbService();
    const people = memoryPeople({ now: () => 5000 });
    let cms: CmsHost;

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), modules: [contentModule], people });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready();
        for (const role of DEFAULT_ROLES) await cms.users.defineRole({ ...role, permissions: [...role.permissions] });
    }, 30_000);

    it('reads who a user is from the port, and keeps the slug and field values itself', async () => {
        await cms.saveFieldGroup({ id: 'staff', title: 'Staff', targets: [{ kind: 'users' }], blocks: [fieldBlock('handle', 'text', { name: 'handle', label: 'Handle', unique: true })] }, admin);
        const ada = await cms.users.create({ email: 'ada@example.com', name: 'Ada Lovelace', roles: ['editor'], meta: { handle: 'ada' } });
        expect(ada).toMatchObject({ email: 'ada@example.com', name: 'Ada Lovelace', status: 'active', roles: ['editor'], slug: 'ada-lovelace', meta: { handle: 'ada' }, account: 'site', createdAt: 5000 });
        expect(ada.permissions).toContain('cms/*');
        // The account is the port's; the CMS keeps the slug.
        expect((await people.getMany([ada.id])).get(ada.id)).toMatchObject({ email: 'ada@example.com' });
        const own = await cms.db.read([{ rql: 'SELECT slug FROM cms_authors WHERE user_id = $id', params: { $id: ada.id } }]);
        expect(own.results[0]!.rows[0]![0]).toBe('ada-lovelace');

        const bob = await cms.users.create({ email: 'bob@example.com', name: 'Ada Lovelace', roles: ['author'] });
        expect(bob.slug).toBe('ada-lovelace-2');
        // A unique field refuses the second user, and the account that was just made is taken back out.
        await expect(cms.users.create({ email: 'eve@example.com', name: 'Eve', meta: { handle: 'ada' } })).rejects.toMatchObject({ code: 'CMS_CONFLICT', fields: { handle: 'is taken.' } });
        expect(await people.findByEmail('eve@example.com')).toBeNull();
        await expect(cms.users.create({ email: 'ada@example.com', name: 'Twin' })).rejects.toMatchObject({ code: 'CMS_CONFLICT', fields: { email: 'is taken.' } });

        expect((await cms.users.findByEmail('ADA@example.com'))?.id).toBe(ada.id);
        expect((await cms.users.bySlug('ada-lovelace-2'))?.id).toBe(bob.id);
        expect([...(await cms.users.getMany([ada.id, 'nobody', bob.id])).keys()].sort()).toEqual([ada.id, bob.id].sort());
        expect(await cms.users.list({ role: 'editor' })).toMatchObject({ total: 1, items: [{ id: ada.id, meta: { handle: 'ada' } }] });
        expect(await cms.users.count()).toBe(2);
        expect((await cms.users.authors()).map(user => user.id)).toEqual([ada.id, bob.id]);
    });

    it('changes the profile through the port and the rest in the CMS, and resolves principals', async () => {
        const ada = (await cms.users.findByEmail('ada@example.com'))!;
        expect(await cms.users.update(ada.id, { name: 'Ada King', meta: { handle: 'countess' } })).toBe(true);
        // The slug stays through a rename; the name is the port's.
        expect(await cms.users.get(ada.id)).toMatchObject({ name: 'Ada King', slug: 'ada-lovelace', meta: { handle: 'countess' } });
        expect((await people.getMany([ada.id])).get(ada.id)!.name).toBe('Ada King');
        expect(await cms.users.setSystemMeta(ada.id, '_recent_blocks', ['core/heading'])).toBe(true);
        expect((await cms.users.get(ada.id))!.meta).toEqual({ handle: 'countess', _recent_blocks: ['core/heading'] });
        expect(await cms.users.setSystemMeta('nobody', '_recent_blocks', [])).toBe(false);

        const member = (await cms.users.resolve(ada.id))!;
        expect(member.principal).toMatchObject({ kind: 'user', id: ada.id, roles: ['editor'] });
        // The principal writes content as any editor does.
        const post = await cms.resource('cms/posts').create({ title: 'From the port', status: 'published' }, { principal: member.principal });
        expect(post.title).toBe('From the port');
        // A network administrator holds everything; a disabled user is nobody.
        people.set(ada.id, { networkAdmin: true });
        expect((await cms.users.principal(ada.id))).toMatchObject({ roles: ['editor', 'network_admin'], permissions: expect.arrayContaining(['*']) });
        people.set(ada.id, { networkAdmin: false, status: 'disabled' });
        expect(await cms.users.resolve(ada.id)).toBeNull();
        people.set(ada.id, { status: 'active' });

        await cms.users.setRoles(ada.id, ['author']);
        expect((await cms.users.get(ada.id))!.roles).toEqual(['author']);
        expect((await cms.users.roles()).map(role => role.id).sort()).toEqual(DEFAULT_ROLES.map(role => role.id).sort());
        expect((await cms.users.role('editor'))?.name).toBe('Editor');
    });

    it('removes a user with their slug and values, and leaves accounts and sign-in to the application', async () => {
        const bob = (await cms.users.findByEmail('bob@example.com'))!;
        expect([await cms.users.delete(bob.id), await cms.users.delete(bob.id)]).toEqual([true, false]);
        expect(await cms.users.bySlug('ada-lovelace-2')).toBeNull();
        expect((await people.getMany([bob.id])).size).toBe(0);
    });
});
