import { beforeAll, describe, expect, it } from 'vitest';
import { contentModule, createCMS, systemPrincipal, type CmsHost } from '../src/server/index';
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
        const saved = await cms.automations.save({ name: 'Tell the team', event: 'entry.published', conditions: { collection: 'posts' }, action: { kind: 'email', to: 'team@example.com', subject: 'Published: {{ title }}', text: 'Read it at {{ url }}' } });
        expect(saved).toMatchObject({ name: 'Tell the team', active: true, runs: 0, conditions: { collection: 'posts' } });
        await cms.automations.save({ name: 'New draft', event: 'entry.created', action: { kind: 'email', to: 'desk@example.com', subject: 'Draft: {{ title }}', text: '{{ collection }} {{ status }}' } });
        expect((await cms.automations.list()).map(entry => entry.name)).toEqual(['Tell the team', 'New draft']);
        await expect(cms.automations.save({ name: '', event: 'entry.published', action: { kind: 'email', to: 'x', subject: '', text: '' } })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        // Posting to a URL is a webhook, not an automation.
        await expect(cms.automations.save({ name: 'Hook', event: 'entry.created', action: { kind: 'webhook', url: 'https://hooks.example/new' } as never })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });

    it('runs on creation and on publication with the entry\'s variables', async () => {
        const posts = cms.resource('cms/posts');
        const draft = await posts.create({ title: 'Launch day', status: 'draft' }, { principal: admin });
        await cms.outbox.dispatch({ limit: 20 });
        expect(sent).toEqual([{ to: 'desk@example.com', from: 'site@example.com', subject: 'Draft: Launch day', text: 'posts draft' }]);
        sent.length = 0;
        await posts.update(draft.id, { status: 'published', slug: 'launch-day' }, { principal: admin, expectedRevision: draft.rev });
        await cms.outbox.dispatch({ limit: 20 });
        expect(sent).toEqual([{ to: 'team@example.com', from: 'site@example.com', subject: 'Published: Launch day', text: 'Read it at https://auto.example/posts/launch-day' }]);
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
        expect(await cms.automations.setActive(failing.id, false)).toBe(true);
        await cms.automations.delete(failing.id);
        expect((await cms.automations.list()).map(entry => entry.name)).toEqual(['Tell the team']);
    });
});
