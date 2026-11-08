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
        const user = await cms.users.create({ email: 'new@example.com', name: 'New', password: 'correct horse battery', roles: [] });
        await cms.users.holdForApproval(user.id, { verified: false });
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

    it('forgets a held registration when the account is deleted', async () => {
        const user = await cms.users.create({ email: 'gone@example.com', name: 'Gone', roles: [] });
        await cms.users.holdForApproval(user.id, { verified: true });
        await cms.users.delete(user.id);
        expect(await cms.users.awaitingApproval(user.id)).toBe(false);
        expect(await cms.users.registrationCount()).toBe(0);
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
