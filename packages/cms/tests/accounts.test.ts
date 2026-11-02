import { beforeAll, describe, expect, it } from 'vitest';
import { createPasswordHasher } from '@cossackframework/auth';
import type { RomeDB } from '@cossackframework/romedb';
import { createCMS, HOST_STEPS, isNetworkAdmin, NETWORK_ADMIN, type CmsHost } from '../src/server/index';
import { romedbService, live } from './helpers';

/** Members keep no password hash: the column is gone. */
const noPasswordColumn = (db: RomeDB) => expect(db.read([{ rql: 'SELECT password_hash FROM cms_users LIMIT 1' }])).rejects.toThrow(/password_hash/);
const count = async (db: RomeDB, rql: string, params: { [key: string]: string } = {}) => Number((await db.read([{ rql, params }])).results[0]!.rows[0]![0] as bigint);

describe.skipIf(!live)('accounts and members', () => {
    const service = romedbService();
    let cms: CmsHost;

    beforeAll(async () => {
        cms = createCMS({ db: service.database() });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.users.defineRole({ id: 'admin', name: 'Administrator', permissions: ['*'] });
        await cms.users.defineRole({ id: 'editor', name: 'Editor', permissions: ['cms:dashboard'] });
    });

    it('keeps credentials on the account and copies the profile to the member', async () => {
        const user = await cms.users.create({ email: 'Ada@Example.com', name: 'Ada', password: 'analytical engine', roles: ['editor'] });
        expect(await cms.accounts.get(user.id)).toMatchObject({ email: 'ada@example.com', name: 'Ada', status: 'active', networkRole: null });
        await noPasswordColumn(cms.db);
        expect((await cms.accounts.verifier.verify('ada@example.com', 'analytical engine'))?.id).toBe(user.id);

        await cms.users.update(user.id, { name: 'Ada Lovelace', email: 'ada@lovelace.example' });
        expect(await cms.accounts.get(user.id)).toMatchObject({ name: 'Ada Lovelace', email: 'ada@lovelace.example' });
        expect(await cms.users.get(user.id)).toMatchObject({ name: 'Ada Lovelace', email: 'ada@lovelace.example', slug: 'ada' });
        await expect(cms.users.create({ email: 'ada@lovelace.example', name: 'Copy', password: 'whatever1' })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });

        await cms.users.setStatus(user.id, 'disabled');
        expect(await cms.users.get(user.id)).toMatchObject({ status: 'disabled' });
        expect(await cms.users.resolve(user.id)).toBeNull();
        await cms.users.setStatus(user.id, 'active');
        expect((await cms.users.resolve(user.id))!.principal).toMatchObject({ roles: ['editor'], permissions: ['cms:dashboard'] });
    });

    it('lets a network admin act with every permission, and keeps the last one', async () => {
        const first = await cms.users.create({ email: 'grace@example.com', name: 'Grace', password: 'compiler one', roles: ['editor'], networkRole: NETWORK_ADMIN });
        const principal = (await cms.users.principal(first.id))!;
        expect(isNetworkAdmin(principal)).toBe(true);
        expect(principal).toMatchObject({ roles: ['editor', NETWORK_ADMIN] });
        expect(principal.kind === 'user' && principal.permissions).toContain('*');
        await expect(cms.users.createRole({ id: NETWORK_ADMIN, name: 'Network admin', permissions: ['*'] })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });

        await expect(cms.accounts.setNetworkRole(first.id, null)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(cms.users.setStatus(first.id, 'disabled')).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(cms.accounts.delete(first.id)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect(await cms.accounts.get(first.id)).toMatchObject({ status: 'active', networkRole: NETWORK_ADMIN });

        const second = await cms.users.create({ email: 'katherine@example.com', name: 'Katherine', password: 'trajectory', networkRole: NETWORK_ADMIN });
        expect(await cms.accounts.setNetworkRole(first.id, null)).toBe(true);
        expect(isNetworkAdmin((await cms.users.principal(first.id))!)).toBe(false);
        await expect(cms.accounts.delete(second.id)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect(await cms.accounts.setNetworkRole('missing', null)).toBe(false);
    });

    it('signs in only where the account is a member', async () => {
        const account = await cms.accounts.create({ email: 'visitor@example.com', name: 'Visitor', password: 'just visiting' });
        expect((await cms.accounts.verifier.verify('visitor@example.com', 'just visiting'))?.id).toBe(account.id);
        expect(await cms.users.resolve(account.id)).toBeNull();
        expect(await cms.users.get(account.id)).toBeNull();
    });

    it('moves the credentials of an existing install to accounts, with its first administrator running the network', async () => {
        const { db, stop } = await service.fresh();
        try {
            for (const step of HOST_STEPS.filter(step => step.version < 16)) {
                await db.write([...step.statements, {
                    rql: "INSERT INTO cms_migrations (id, kind, owner, resource, version, declaration_hash, rql, engine_version, applied_at) VALUES ($id, 'host', 'cms', NULL, $version, NULL, '', 'test', 1)",
                    params: { $id: `cms#host-${step.version}`, $version: step.version },
                }], { kind: 'test' });
            }
            const hash = await createPasswordHasher().hash('old password');
            const user = (id: string, email: string, status: string, created: number) => ({
                rql: "INSERT INTO cms_users (id, email, name, password_hash, avatar, status, created_at, updated_at, meta) VALUES ($id, $email, $email, $hash, NULL, $status, $created, $created, '{}')",
                params: { $id: id, $email: email, $hash: hash, $status: status, $created: created },
            });
            await db.write([
                { rql: "INSERT INTO cms_roles (id, name, permissions, created_at) VALUES ('admin', 'Administrator', '[\"*\"]', 1)" },
                user('gone', 'gone@example.com', 'disabled', 1), user('owner', 'owner@example.com', 'active', 2), user('helper', 'helper@example.com', 'active', 3), user('reader', 'reader@example.com', 'active', 4),
                { rql: "INSERT INTO cms_user_roles (user_id, role_id) VALUES ('gone', 'admin'), ('owner', 'admin'), ('helper', 'admin')" },
            ], { kind: 'test' });

            const upgraded = createCMS({ db });
            await upgraded.ready();
            expect(await upgraded.installed()).toBe(true);
            expect(await count(db, "SELECT count(*) FROM cms_migrations WHERE id = 'cms#host-16'")).toBe(1);
            await noPasswordColumn(db);
            expect(await count(db, 'SELECT count(*) FROM cms_accounts')).toBe(4);
            expect(await upgraded.accounts.get('owner')).toMatchObject({ email: 'owner@example.com', networkRole: NETWORK_ADMIN });
            expect(await upgraded.accounts.get('helper')).toMatchObject({ networkRole: null });
            expect(await upgraded.accounts.get('gone')).toMatchObject({ status: 'disabled', networkRole: null });
            expect((await upgraded.accounts.verifier.verify('reader@example.com', 'old password'))?.id).toBe('reader');
            expect(isNetworkAdmin((await upgraded.users.principal('owner'))!)).toBe(true);
            // Host step 19 records the main site's members.
            expect(await count(db, "SELECT count(*) FROM cms_memberships WHERE site_id = 'main'")).toBe(4);
        } finally { await stop(); }
    }, 60_000);

    it('keeps accounts and what signs them in on the network database, and members and child sessions on the site', async () => {
        const other = await service.fresh();
        try {
            const site = createCMS({ db: other.db, network: cms.db });
            expect((await site.migrate()).failed).toBeUndefined();
            await site.users.defineRole({ id: 'author', name: 'Author', permissions: ['cms:dashboard'] });
            const user = await site.users.create({ email: 'member@example.com', name: 'Member', password: 'members only', roles: ['author'] });
            await site.authSessions.create({ id: 'm'.repeat(64), userId: user.id, kind: 'auth', createdAt: Date.now(), expiresAt: Date.now() + 60_000 });
            await site.apiTokens.create(user.id, { name: 'Script', scope: 'read' });
            await site.security.startTotp(user.id);

            // A site's sessions are child sessions in its own database (handoffs.test.ts).
            expect(await count(other.db, 'SELECT count(*) FROM cms_auth_sessions WHERE user_id = $id', { $id: user.id })).toBe(1);
            expect(await count(cms.db, 'SELECT count(*) FROM cms_auth_sessions WHERE user_id = $id', { $id: user.id })).toBe(0);
            for (const table of ['cms_accounts', 'cms_api_tokens', 'cms_user_security']) {
                expect(await count(cms.db, `SELECT count(*) FROM ${table} WHERE ${table === 'cms_accounts' ? 'id' : 'user_id'} = $id`, { $id: user.id }), table).toBe(1);
                expect(await count(other.db, `SELECT count(*) FROM ${table}`), table).toBe(0);
            }
            expect(await count(other.db, 'SELECT count(*) FROM cms_users WHERE id = $id', { $id: user.id })).toBe(1);
            expect(await count(cms.db, 'SELECT count(*) FROM cms_users WHERE id = $id', { $id: user.id })).toBe(0);
            expect((await site.accounts.verifier.verify('member@example.com', 'members only'))?.id).toBe(user.id);
            expect((await site.users.resolve(user.id))!.principal).toMatchObject({ roles: ['author'] });
            // The main site has the account but no member, so it does not sign in there.
            expect(await cms.users.resolve(user.id)).toBeNull();
            expect((await site.tokenPrincipal((await site.apiTokens.create(user.id, { name: 'Again', scope: 'write' })).token))?.userId).toBe(user.id);
        } finally { await other.stop(); }
    }, 60_000);
});
