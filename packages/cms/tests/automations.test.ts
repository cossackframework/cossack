import { beforeAll, describe, expect, it } from 'vitest';
import { contentModule, createCMS, field, systemPrincipal, userPrincipal, type CmsHost } from '../src/server/index';
import { live, romedbService } from './helpers';

const admin = systemPrincipal('automation tests');

describe.skipIf(!live)('automations', () => {
    const service = romedbService();
    const sent: { to: string; subject: string; text: string }[] = [];
    /** Set to make the sender fail, as a mail service that is down would. */
    let mailDown = false;
    let cms: CmsHost;

    beforeAll(async () => {
        cms = createCMS({
            db: service.database(), modules: [contentModule], mail: { send: async ({ html, ...message }) => { if (mailDown) throw new Error('The mail service is down.'); expect(html).toContain(message.subject); sent.push(message); } }, mailFrom: 'site@example.com', siteUrl: 'https://auto.example',
        });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready();
    }, 30_000);

    it('saves, lists and refuses bad automations', async () => {
        const saved = await cms.automations.save({ name: 'Tell the team', event: 'entry.published', conditions: { collection: 'posts' }, action: { kind: 'email', to: 'team@example.com', subject: 'Published: {{ $.title }}', text: 'Read it at {{ $.url }} ({{ $site.title }}, by {{ $user.name }})' } }, { principal: admin });
        expect(saved).toMatchObject({ name: 'Tell the team', active: true, runs: 0, conditions: { collection: 'posts' } });
        await cms.automations.save({ name: 'New draft', event: 'entry.created', action: { kind: 'email', to: 'desk@example.com', subject: 'Draft: {{ $.title }}', text: '{{ $.collection }} {{ $.status }}' } }, { principal: admin });
        expect((await cms.automations.list()).map(entry => entry.name)).toEqual(['Tell the team', 'New draft']);
        await expect(cms.automations.save({ name: '', event: 'entry.published', action: { kind: 'email', to: 'x', subject: '', text: '' } }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        // Posting to a URL is a webhook, not an automation.
        await expect(cms.automations.save({ name: 'Hook', event: 'entry.created', action: { kind: 'webhook', url: 'https://hooks.example/new' } as never }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });

    it('runs on creation and on publication with the entry\'s variables', async () => {
        const posts = cms.resource('cms/posts');
        const draft = await posts.create({ title: 'Launch day', status: 'draft' }, { principal: admin });
        await cms.outbox.dispatch({ limit: 20 });
        expect(sent).toEqual([{ to: 'desk@example.com', from: 'site@example.com', subject: 'Draft: Launch day', text: 'posts draft' }]);
        sent.length = 0;
        await posts.update(draft.id, { status: 'published', slug: 'launch-day' }, { principal: admin, expectedRevision: draft.rev });
        await cms.outbox.dispatch({ limit: 20 });
        expect(sent).toEqual([{ to: 'team@example.com', from: 'site@example.com', subject: 'Published: Launch day', text: 'Read it at https://auto.example/posts/launch-day (My Site, by )' }]);
        expect((await cms.automations.list()).find(entry => entry.name === 'Tell the team')).toMatchObject({ runs: 1, lastError: '' });
    });

    it('records a failing action and lets the outbox retry it', async () => {
        mailDown = true;
        const posts = cms.resource('cms/posts');
        await posts.create({ title: 'Second', status: 'draft' }, { principal: admin });
        const report = await cms.outbox.dispatch({ limit: 20 });
        expect(report.retrying.map(entry => entry.plugins)).toEqual([['cms-automations']]);
        expect((await cms.automations.list()).find(entry => entry.name === 'New draft')).toMatchObject({ lastError: 'The mail service is down.' });
        const failing = (await cms.automations.list()).find(entry => entry.name === 'New draft')!;
        expect(await cms.automations.setActive(failing.id, false, admin)).toBe(true);
        await cms.automations.delete(failing.id);
        expect((await cms.automations.list()).map(entry => entry.name)).toEqual(['Tell the team']);
    });

    it('needs read access to what an automation sends, to save it or switch it on', async () => {
        const settingsOnly = userPrincipal('settings', ['manager'], ['cms:dashboard', 'cms:settings']);
        const reply = { name: 'Copy out', event: 'form.submitted' as const, action: { kind: 'email' as const, to: 'out@example.com', subject: 'Message', text: '{{ $.values.message }}' } };
        await expect(cms.automations.save(reply, { principal: settingsOnly })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(cms.automations.save({ ...reply, event: 'entry.updated', conditions: { collection: 'posts' } }, { principal: settingsOnly })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        const off = await cms.automations.save({ ...reply, active: false }, { principal: admin });
        await expect(cms.automations.setActive(off.id, true, settingsOnly)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await cms.automations.delete(off.id);
    });

    it('runs as its author: without the fields they may not read, and not once they can no longer act', async () => {
        sent.length = 0;
        mailDown = false;
        await cms.saveCollection({ name: 'staff', label: 'Staff', singular: 'Person', icon: 'user', path: null, fields: { salary: field.string({ access: { read: 'cms:hr' } }) } }, admin);
        const role = await cms.users.createRole({ name: 'Writer', permissions: ['cms:dashboard', 'cms/*'] });
        const writer = await cms.users.create({ email: 'writer@example.com', name: 'Writer', password: 'a long password', roles: [role.id] });
        const editor = (await cms.users.principal(writer.id))!;
        const copy = await cms.automations.save({ name: 'Pay copy', event: 'entry.created', conditions: { collection: 'staff' }, action: { kind: 'email', to: 'writer@example.com', subject: 'Staff', text: 'Pay: {{ $.record.salary }}.' } }, { principal: editor });
        expect(copy.author).toBe(writer.id);
        await cms.resource('cms/staff').create({ title: 'Ada', salary: '99000' }, { principal: admin });
        await cms.outbox.dispatch({ limit: 20 });
        expect(sent).toEqual([expect.objectContaining({ to: 'writer@example.com', text: 'Pay: .' })]);
        // Their account gone, it no longer runs.
        sent.length = 0;
        await cms.users.delete(writer.id);
        await cms.resource('cms/staff').create({ title: 'Grace', salary: '1' }, { principal: admin });
        await cms.outbox.dispatch({ limit: 20 });
        expect(sent).toEqual([]);
        expect((await cms.automations.get(copy.id))!.lastError).toContain('author');
        await cms.automations.delete(copy.id);
    });

    it('on a retry, sends only what did not go out, and does not retry an automation with no recipient', async () => {
        sent.length = 0;
        mailDown = false;
        const team = await cms.automations.save({ name: 'Team copy', event: 'form.submitted', action: { kind: 'email', to: 'team@example.com', subject: 'Form', text: 'x' } }, { principal: admin });
        const visitor = await cms.automations.save({ name: 'Auto reply', event: 'form.submitted', action: { kind: 'email', to: '{{ $.values.email }}', subject: 'Thanks', text: 'x' } }, { principal: admin });
        // No address given: recorded, not thrown, so the outbox does not send the team's copy again.
        await expect(cms.automations.run('form.submitted', { values: { email: '' } }, {}, 'delivery-1')).resolves.toMatchObject({ ran: [team.id], failed: [visitor.id] });
        await cms.automations.run('form.submitted', { values: { email: '' } }, {}, 'delivery-1');
        expect(sent.filter(message => message.to === 'team@example.com')).toHaveLength(1);
        await cms.automations.delete(team.id);
        await cms.automations.delete(visitor.id);
    });
});
