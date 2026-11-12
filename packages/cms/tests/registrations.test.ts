import { beforeAll, describe, expect, it } from 'vitest';
import {
    ANONYMOUS, contentModule, createCMS, DEFAULT_ROLES, userBeforeRegister, userRegistered, userSignedIn,
    type CmsHost, type CmsModule, type Principal, type UserRegisteredEvent, type UserSignedInEvent,
} from '../src/server/index';

const admin: Principal = { kind: 'user', id: 'admin-1', roles: ['admin'], permissions: ['*'] };
const registered: UserRegisteredEvent[] = [];
const signedIn: UserSignedInEvent[] = [];
/** A plugin's handlers, registered at boot as plugins' are. */
const plugin: CmsModule = {
    owner: 'allowlist', resources: [],
    register({ hooks }) {
        hooks.addFilter(userBeforeRegister, (draft, { input }) => {
            if (draft.email.endsWith('@spam.example')) return { ...draft, refused: 'Use your work email.' };
            if (!draft.email.endsWith('@work.example')) return draft;
            return { ...draft, email: 'attacker@example.com', name: `${draft.name} (${input.origin})`, roles: ['editor', 'no-such-role'], approval: true };
        }, { plugin: 'allowlist' });
        hooks.addAction(userRegistered, event => { registered.push(event); }, { plugin: 'crm' });
        hooks.addAction(userSignedIn, event => { signedIn.push(event); }, { plugin: 'crm' });
    },
};
import { romedbService, live } from './helpers';

describe.skipIf(!live)('registration approval, members-only entries and the user hooks', () => {
    const service = romedbService();
    let clock = Date.UTC(2026, 10, 8, 9, 0);
    let cms: CmsHost;
    let member: Principal;

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), modules: [contentModule, plugin], now: () => clock, siteUrl: 'https://members.example' });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready({ force: true });
        for (const role of DEFAULT_ROLES) await cms.users.defineRole({ ...role, permissions: [...role.permissions] });
        member = (await cms.users.principal((await cms.users.create({ email: 'reader@example.com', name: 'Reader', roles: ['subscriber'] })).id))!;
    }, 30_000);

    it('holds an account until its email is confirmed and an administrator approves it', async () => {
        const user = await cms.users.create({ email: 'new@example.com', name: 'New', password: 'correct horse battery', roles: [], approval: { verified: false } });
        expect(await cms.users.awaitingApproval(user.id)).toBe(true);
        expect((await cms.users.get(user.id))!.status).toBe('disabled');
        expect(await cms.users.registrationCount()).toBe(1);
        await expect(cms.users.approve(user.id)).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        expect(await cms.users.confirmRegistration(user.id)).toBe(true);
        expect(await cms.users.registrations()).toMatchObject([{ user: { id: user.id }, verified: true }]);
        expect(await cms.users.approve(user.id)).toBe(true);
        expect((await cms.users.get(user.id))!.status).toBe('active');
        expect(await cms.users.awaitingApproval(user.id)).toBe(false);
        expect(await cms.users.approve(user.id)).toBe(false);
        // Not waiting: the link of a plain registration activates nothing more.
        expect(await cms.users.confirmRegistration(user.id)).toBe(false);
    });

    it('finishes an approval interrupted after activating, and leaves no member behind a failed membership', async () => {
        // The same database through a binding that fails writes matching `failing`.
        let failing: RegExp | null = null;
        const faulty = new Proxy(service.database(), {
            get(target, property) {
                if (property === 'write') return async (statements: { rql: string }[], options?: unknown) => {
                    if (failing && statements.some(statement => failing!.test(statement.rql))) { failing = null; throw new Error('write lost'); }
                    return target.write(statements as never, options as never);
                };
                const value = Reflect.get(target, property, target) as unknown;
                return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
            },
        });
        const other = createCMS({ db: faulty, modules: [contentModule, plugin], now: () => clock, siteUrl: 'https://members.example' });
        await other.ready();
        const user = await other.users.create({ email: 'held@example.com', name: 'Held', password: 'correct horse battery', roles: [], approval: { verified: true } });
        failing = /DELETE FROM cms_registrations/;
        await expect(other.users.approve(user.id)).rejects.toThrow('write lost');
        // Active already, and still in the queue: approving again finishes it.
        expect((await other.users.get(user.id))!.status).toBe('active');
        expect(await other.users.awaitingApproval(user.id)).toBe(true);
        expect(await other.users.approve(user.id)).toBe(true);
        expect(await other.users.awaitingApproval(user.id)).toBe(false);
        // A membership the network could not record takes the member row with it, so the email stays free.
        failing = /INSERT INTO cms_memberships/;
        await expect(other.users.create({ email: 'orphan@example.com', name: 'Orphan', roles: ['subscriber'] })).rejects.toThrow('write lost');
        expect(await other.users.findByEmail('orphan@example.com')).toBeNull();
        expect((await other.users.create({ email: 'orphan@example.com', name: 'Orphan', roles: ['subscriber'] })).email).toBe('orphan@example.com');
        // A held account starts disabled with its place in the queue, written with its member row:
        // when that write fails, no account is left, active or out of the queue.
        const waiting = await other.users.create({ email: 'waiting@example.com', name: 'Waiting', roles: ['subscriber'], approval: { verified: false } });
        expect([(await other.users.get(waiting.id))!.status, await other.users.awaitingApproval(waiting.id)]).toEqual(['disabled', true]);
        failing = /INSERT INTO cms_registrations/;
        await expect(other.users.create({ email: 'skipped@example.com', name: 'Skipped', roles: ['subscriber'], approval: { verified: false } })).rejects.toThrow('write lost');
        expect(await other.users.findByEmail('skipped@example.com')).toBeNull();
        expect(await other.accounts.findByEmail('skipped@example.com')).toBeNull();
        await other.users.delete(waiting.id);
    });

    it('forgets a held registration when the account is deleted', async () => {
        const user = await cms.users.create({ email: 'gone@example.com', name: 'Gone', roles: [], approval: { verified: true } });
        await cms.users.delete(user.id);
        expect(await cms.users.awaitingApproval(user.id)).toBe(false);
        expect(await cms.users.registrationCount()).toBe(0);
        // The account made for the turned-down registration goes too: the email registers again.
        expect(await cms.accounts.findByEmail('gone@example.com')).toBeNull();
        const again = await cms.users.create({ email: 'gone@example.com', name: 'Gone again', roles: [], approval: { verified: true } });
        expect(await cms.users.awaitingApproval(again.id)).toBe(true);
        await cms.users.delete(again.id);
    });

    it('keeps an account that signed in or belongs to another site when a member leaves', async () => {
        const kept = await cms.users.create({ email: 'kept@example.com', name: 'Kept', roles: [] });
        await cms.users.delete(kept.id);
        expect(await cms.accounts.findByEmail('kept@example.com')).not.toBeNull();
        await cms.accounts.delete(kept.id);
    });

    it('lets before-register filters refuse, rename, choose roles and hold for approval', async () => {
        await expect(cms.registrationDraft({ email: 'bot@spam.example', name: 'Bot', roles: ['subscriber'], approval: false }, { origin: 'https://members.example' }))
            .rejects.toMatchObject({ code: 'CMS_VALIDATION', message: 'Use your work email.' });
        expect(await cms.registrationDraft({ email: 'ann@work.example', name: 'Ann', roles: ['subscriber'], approval: false }, { origin: 'https://members.example' }))
            .toEqual({ email: 'ann@work.example', name: 'Ann (https://members.example)', roles: ['editor'], approval: true, refused: null });
        expect(await cms.registrationDraft({ email: 'bo@home.example', name: 'Bo', roles: ['subscriber'], approval: false }, { origin: 'https://members.example' }))
            .toEqual({ email: 'bo@home.example', name: 'Bo', roles: ['subscriber'], approval: false, refused: null });
    });

    it('queues registered and signed-in events for plugins, once per account and session', async () => {
        {
            const user = await cms.users.get(member.kind === 'user' ? member.id : '');
            await cms.userRegistered(user!, 'approval');
            await cms.userRegistered(user!, 'approval');
            await cms.userSignedIn(user!, 'session-1');
            await cms.userSignedIn(user!, 'session-1');
            await cms.userSignedIn(user!, 'session-2');
            await cms.outbox.dispatch({ limit: 20 });
            expect(registered).toMatchObject([{ topic: 'user.registered', state: 'approval', user: { email: 'reader@example.com' } }]);
            expect(signedIn).toHaveLength(2);
            expect(signedIn[0]).toMatchObject({ topic: 'user.signed-in', user: { name: 'Reader' } });
            expect(signedIn[0]!.eventId).not.toContain('session-1');
            // Queued in the session's own write: a session that is stored has its event, one that is not has none.
            const id = 'a'.repeat(64);
            await cms.authSessions.create({ id, userId: user!.id, kind: 'auth', createdAt: clock, expiresAt: clock + 60_000 } as never, undefined, { also: [await cms.userSignedInStatement(user!, id)] });
            await cms.outbox.dispatch({ limit: 20 });
            expect(signedIn).toHaveLength(3);
            await expect(cms.authSessions.create({ id, userId: user!.id, kind: 'auth', createdAt: clock, expiresAt: clock + 60_000 } as never, undefined, { also: [await cms.userSignedInStatement(user!, `${id}x`)] })).rejects.toThrow();
            await cms.outbox.dispatch({ limit: 20 });
            expect(signedIn).toHaveLength(3);
        }
    });

    it('keeps members-only entries readable through the repository like any published entry', async () => {
        const repository = cms.resource('cms/posts');
        const post = await repository.create({ title: 'For members', status: 'published', membersOnly: true }, { principal: admin });
        // The repository does not hide it: the site and the content API withhold its content, and list its title.
        expect(await repository.get(post.id, { principal: ANONYMOUS })).toMatchObject({ title: 'For members', membersOnly: true });
        expect(Object.keys(cms.resourceById('cms/pages').fields)).toContain('membersOnly');
        expect(Object.keys(cms.resourceById('cms/posts').fields)).toContain('unpublishAt');
    });
});
