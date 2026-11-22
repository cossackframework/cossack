import { describe, expect, it } from 'vitest';
import { memoryPeople, personPermissions } from '../src/server/people';

describe('the in-memory people port', () => {
    it('keeps users with their roles of this site, found by ID, email, search and role', async () => {
        const people = memoryPeople({ now: () => 1000 });
        await people.defineRole({ id: 'editor', name: 'Editor', permissions: ['cms/posts:*', 'cms:media'] });
        await people.defineRole({ id: 'author', name: 'Author', permissions: ['cms/posts:create'] });
        const ada = await people.create({ email: ' Ada@Example.com ', name: 'Ada', roles: ['editor', 'author'] });
        const bob = await people.create({ email: 'bob@example.com', name: 'bob', roles: ['author'] });
        expect(ada).toMatchObject({ email: 'ada@example.com', status: 'active', account: 'site', networkAdmin: false, createdAt: 1000, lastSignInAt: null });
        expect(ada.roles.map(role => role.id)).toEqual(['author', 'editor']);
        expect([...(await people.getMany([bob.id, 'nobody', ada.id])).keys()].sort()).toEqual([ada.id, bob.id].sort());
        expect((await people.findByEmail('ADA@example.com'))?.id).toBe(ada.id);
        expect((await people.list({ search: 'bob' })).users.map(user => user.id)).toEqual([bob.id]);
        expect(await people.list({ role: 'editor' })).toMatchObject({ total: 1, users: [{ id: ada.id }] });
        expect((await people.list({ limit: 1, offset: 1 })).users.map(user => user.name)).toEqual(['bob']);
        expect(await people.count()).toBe(2);
    });

    it('refuses a taken email and an unknown role, and changes roles and profiles', async () => {
        const people = memoryPeople();
        await people.defineRole({ id: 'editor', name: 'Editor', permissions: [] });
        const ada = await people.create({ email: 'ada@example.com', name: 'Ada' });
        await expect(people.create({ email: 'ada@example.com', name: 'Other' })).rejects.toMatchObject({ code: 'CMS_CONFLICT', fields: { email: 'is taken.' } });
        await expect(people.create({ email: 'eve@example.com', name: 'Eve', roles: ['nope'] })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(people.setRoles(ada.id, ['nope'])).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await people.setRoles(ada.id, ['editor']);
        expect(await people.update(ada.id, { name: 'Ada L.', avatar: '/a.png' })).toBe(true);
        expect((await people.getMany([ada.id])).get(ada.id)).toMatchObject({ name: 'Ada L.', avatar: '/a.png', roles: [{ id: 'editor' }] });
        expect(await people.update('nobody', { name: 'x' })).toBe(false);
        expect([await people.delete(ada.id), await people.delete(ada.id)]).toEqual([true, false]);
    });

    it('gives a role new permissions when it is defined again, and a network administrator everything', async () => {
        const people = memoryPeople();
        await people.defineRole({ id: 'editor', name: 'Editor', permissions: ['cms:media'] });
        const ada = await people.create({ email: 'ada@example.com', name: 'Ada', roles: ['editor'] });
        await people.defineRole({ id: 'editor', name: 'Editor', permissions: ['cms:media', 'cms/posts:*'] });
        const again = (await people.getMany([ada.id])).get(ada.id)!;
        expect(personPermissions(again)).toEqual(['cms/posts:*', 'cms:media']);
        people.set(ada.id, { networkAdmin: true });
        expect(personPermissions((await people.getMany([ada.id])).get(ada.id)!)).toEqual(['*']);
    });
});
