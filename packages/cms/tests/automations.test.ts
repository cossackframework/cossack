import { beforeAll, describe, expect, it } from 'vitest';
import { contentModule, createCMS, systemPrincipal, type CmsHost } from '../src/server/index';
import { live, romedbService } from './helpers';

const admin = systemPrincipal('automation tests');

describe.skipIf(!live)('automations', () => {
    const service = romedbService();
    const sent: { to: string; subject: string; text: string }[] = [];
    const posted: { url: string; headers: Record<string, string>; body: string }[] = [];
    let webhookStatus = 200;
    let cms: CmsHost;

    beforeAll(async () => {
        cms = createCMS({
            db: service.database(), modules: [contentModule], mail: { send: async message => { sent.push(message); } }, mailFrom: 'site@example.com', siteUrl: 'https://auto.example',
            fetch: (async (url: string | URL | Request, init?: RequestInit) => { posted.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: String(init?.body) }); return new Response(null, { status: webhookStatus }); }) as typeof fetch,
        });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready();
    }, 30_000);

    it('saves, lists and refuses bad automations', async () => {
        const saved = await cms.automations.save({ name: 'Tell the team', event: 'entry.published', conditions: { collection: 'posts' }, action: { kind: 'email', to: 'team@example.com', subject: 'Published: {{ title }}', text: 'Read it at {{ url }}' } });
        expect(saved).toMatchObject({ name: 'Tell the team', active: true, runs: 0, conditions: { collection: 'posts' } });
        await cms.automations.save({ name: 'Hook', event: 'entry.created', action: { kind: 'webhook', url: 'https://hooks.example/new', secret: 'longenough-secret' } });
        expect((await cms.automations.list()).map(entry => entry.name)).toEqual(['Tell the team', 'Hook']);
        await expect(cms.automations.save({ name: '', event: 'entry.published', action: { kind: 'email', to: 'x', subject: '', text: '' } })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });

    it('runs on publication with the entry\'s variables and posts signed webhooks', async () => {
        const posts = cms.resource('cms/posts');
        const draft = await posts.create({ title: 'Launch day', status: 'draft' }, { principal: admin });
        await cms.outbox.dispatch({ limit: 20 });
        expect(sent).toEqual([]);
        expect(posted).toHaveLength(1);
        expect(posted[0]!.url).toBe('https://hooks.example/new');
        expect(posted[0]!.headers['x-cossack-event']).toBe('entry.created');
        expect(posted[0]!.headers['x-cossack-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
        expect(JSON.parse(posted[0]!.body)).toMatchObject({ name: 'Hook', event: 'entry.created', data: { collection: 'posts', title: 'Launch day', status: 'draft' } });
        await posts.update(draft.id, { status: 'published', slug: 'launch-day' }, { principal: admin, expectedRevision: draft.rev });
        await cms.outbox.dispatch({ limit: 20 });
        expect(sent).toEqual([{ to: 'team@example.com', from: 'site@example.com', subject: 'Published: Launch day', text: 'Read it at https://auto.example/posts/launch-day' }]);
        expect((await cms.automations.list()).find(entry => entry.name === 'Tell the team')).toMatchObject({ runs: 1, lastError: '' });
    });

    it('records a failing action and lets the outbox retry it', async () => {
        webhookStatus = 500;
        const posts = cms.resource('cms/posts');
        await posts.create({ title: 'Second', status: 'draft' }, { principal: admin });
        const report = await cms.outbox.dispatch({ limit: 20 });
        expect(report.retrying.map(entry => entry.plugins)).toEqual([['cms-automations']]);
        expect((await cms.automations.list()).find(entry => entry.name === 'Hook')).toMatchObject({ lastError: 'The webhook answered 500.' });
        const hook = (await cms.automations.list()).find(entry => entry.name === 'Hook')!;
        expect(await cms.automations.setActive(hook.id, false)).toBe(true);
        await cms.automations.delete(hook.id);
        expect((await cms.automations.list()).map(entry => entry.name)).toEqual(['Tell the team']);
    });
});
