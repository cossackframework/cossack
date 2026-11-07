import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ROLES, nextCronTime, SYSTEM_META } from '../src/index';
import { createCMS, systemPrincipal, type CmsHost, type PluginContext } from '../src/server/index';
import { live, memoryStorage, pngBytes, romedbService } from './helpers';

const admin = systemPrincipal('capability tests');

describe.skipIf(!live)('plugin capabilities', () => {
    const service = romedbService();
    let clock = Date.parse('2026-11-07T10:00:30Z');
    const sent: { to: string; from: string; subject: string; text: string }[] = [];
    const ran: { name: string; payload: unknown; scheduledAt: number | null }[] = [];
    let failures = 1;
    let cms: CmsHost;
    let context: PluginContext;
    const manifest = {
        schemaVersion: 1, name: 'desk', version: '1.0.0',
        permissions: { files: true, mail: true, jobs: true, cache: true, ai: true, payments: true, users: ['read', 'write'], secrets: ['STRIPE_SECRET_KEY'] },
        schedules: [{ name: 'heartbeat', cron: '*/5 * * * *' }],
    };
    const plugin = () => ({
        name: 'desk', version: '1.0.0', manifest,
        module: {
            register(value: PluginContext) {
                // The first host's context; a second host (the twin below) registers its own.
                context ??= value;
                value.jobs.handle('notify', (payload, { scheduledAt }) => { ran.push({ name: 'notify', payload, scheduledAt }); });
                value.jobs.handle('heartbeat', (payload, { scheduledAt }) => { ran.push({ name: 'heartbeat', payload, scheduledAt }); });
                value.jobs.handle('flaky', payload => { if (failures-- > 0) throw new Error('not yet'); ran.push({ name: 'flaky', payload, scheduledAt: null }); });
            },
        },
    });
    const host = () => createCMS({
        db: service.database(), plugins: [plugin()], storage: memoryStorage(), now: () => clock,
        mail: { send: async message => { sent.push(message); } }, mailFrom: 'site@example.com',
        secrets: name => ({ STRIPE_SECRET_KEY: 'sk_test_123' })[name],
        ai: { name: 'fake', complete: async request => `echo:${request.prompt}` },
        payments: { name: 'fake-pay', checkout: async input => ({ id: 'c1', url: `https://pay.test/${input.reference ?? ''}` }), webhook: async () => null },
    });

    beforeAll(async () => {
        cms = host();
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready();
        for (const role of DEFAULT_ROLES) await cms.users.defineRole(role);
    }, 30_000);

    it('refuses every capability before the grant', async () => {
        expect(await cms.pluginActive('desk')).toBe(false);
        await expect(context.mail.send({ to: 'a@b.co', subject: 'x', text: 'y' })).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        await expect(context.cache.get('k')).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        await expect(context.secrets.get('STRIPE_SECRET_KEY')).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        expect(await cms.schedules.tick()).toEqual({ queued: [], skipped: [] });
        expect(await cms.schedules.list()).toEqual([]);
    });

    it('serves them after the grant, each in its namespace', async () => {
        const status = await cms.grantPlugin('desk', admin);
        expect(status.active).toBe(true);
        expect(status.requests).toEqual(expect.arrayContaining(['capability:files', 'capability:mail', 'capability:jobs', 'capability:cache', 'users:read', 'users:write', 'secret:STRIPE_SECRET_KEY']));

        await context.cache.set('count', 3, 60_000);
        expect(await context.cache.get('count')).toBe(3);
        expect(await cms.cache.get('plugin:desk:count')).toBe(3);
        expect(await context.cache.remember('slow', 60_000, async () => 'computed')).toBe('computed');
        await context.cache.delete('count');
        expect(await context.cache.get('count')).toBeUndefined();

        expect(await context.secrets.get('STRIPE_SECRET_KEY')).toBe('sk_test_123');
        await expect(context.secrets.get('APP_SECRET')).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });

        await context.mail.send({ to: 'ada@example.com', subject: 'Ticket closed', text: 'Done.' });
        expect(sent).toEqual([{ to: 'ada@example.com', from: 'site@example.com', subject: 'Ticket closed', text: 'Done.' }]);
        expect(await context.ai.complete({ prompt: 'hello' })).toBe('echo:hello');
        expect(context.payments.provider).toBe('fake-pay');
        expect((await context.payments.checkout({ successUrl: 'https://s.test/a', cancelUrl: 'https://s.test/b', priceId: 'price_1', reference: 'o1' })).url).toBe('https://pay.test/o1');
    });

    it('stores files the plugin owns in the library', async () => {
        const file = await context.files.upload({ name: 'receipt.png', contentType: 'image/png', body: pngBytes(4, 4), title: 'Receipt' });
        expect(file.owner).toBe('plugin:desk');
        expect(file.title).toBe('Receipt');
        expect(context.files.url(file)).toContain(file.id);
        expect((await context.files.list()).items.map(item => item.id)).toEqual([file.id]);
        expect((await cms.files!.get(file.id))?.name).toBe('receipt.png');
        const opened = await context.files.open(file.id);
        expect(opened?.file.id).toBe(file.id);
        await opened?.body.cancel();
        expect((await context.files.update(file.id, { alt: 'A receipt' })).alt).toBe('A receipt');
        // Someone else's file is read, not changed.
        const other = await cms.files!.upload({ name: 'other.png', contentType: 'image/png', size: 29, body: new Response(pngBytes(2, 2).buffer).body! }, { principal: admin });
        expect((await context.files.get(other.id))?.id).toBe(other.id);
        await expect(context.files.delete(other.id)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(context.files.upload({ name: 's.png', contentType: 'image/png', body: new Response(pngBytes(2, 2).buffer).body! })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await context.files.delete(file.id);
        expect((await context.files.list()).total).toBe(0);
    });

    it('reads and creates members within the assignable roles', async () => {
        const ada = await cms.users.create({ email: 'ada@example.com', name: 'Ada', roles: ['admin'] });
        expect((await context.users.get(ada.id))).toMatchObject({ email: 'ada@example.com', roles: ['admin'], meta: null });
        expect((await context.users.get(ada.id)) as object).not.toHaveProperty('permissions');
        expect((await context.users.findByEmail('ADA@example.com'))?.id).toBe(ada.id);
        expect((await context.users.list({ search: 'ada' })).total).toBe(1);
        await expect(context.users.create({ email: 'eve@example.com', name: 'Eve', roles: ['admin'] })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(context.users.create({ email: 'eve@example.com', name: 'Eve', roles: ['editor'] })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        const eve = await context.users.create({ email: 'eve@example.com', name: 'Eve', roles: ['subscriber'] });
        expect(eve.roles).toEqual(['subscriber']);
        expect(await context.users.setMeta(eve.id, { tickets: 2 })).toBe(true);
        expect((await context.users.get(eve.id))?.meta).toEqual({ tickets: 2 });
        const stored = await cms.users.get(eve.id);
        const key = Object.keys(stored!.meta).find(name => SYSTEM_META.test(name));
        expect(key).toBe('_p_desk');
        expect(await context.users.setMeta(eve.id, null)).toBe(true);
        expect((await context.users.get(eve.id))?.meta).toBeNull();
    });

    it('queues jobs through the outbox, once per key, with retries', async () => {
        expect(await context.jobs.enqueue('notify', { ticket: 1 }, { key: 'ticket-1' })).toBe(true);
        expect(await context.jobs.enqueue('notify', { ticket: 1 }, { key: 'ticket-1' })).toBe(false);
        expect(await context.jobs.enqueue('notify', { ticket: 2 }, { delayMs: 90_000 })).toBe(true);
        expect(await context.jobs.enqueue('flaky', 'f')).toBe(true);
        // Member and file writes queued after-commit events too; only the job rows matter here.
        const jobsOf = (ids: readonly string[]) => ids.filter(id => id.startsWith('job:'));
        const first = await cms.outbox.dispatch({ limit: 10 });
        expect(jobsOf(first.delivered)).toEqual(['job:desk:notify:ticket-1']);
        expect(first.retrying.map(entry => entry.plugins)).toEqual([['desk']]);
        expect(ran).toEqual([{ name: 'notify', payload: { ticket: 1 }, scheduledAt: null }]);
        // The delayed job and the retry wait for the clock.
        clock += 2_000;
        const second = await cms.outbox.dispatch({ limit: 10 });
        expect(jobsOf(second.delivered).length + second.retrying.length).toBe(1);
        clock += 90_000;
        const third = await cms.outbox.dispatch({ limit: 10 });
        expect(ran.map(entry => entry.name).sort()).toEqual(['flaky', 'notify', 'notify']);
        expect(third.retrying).toEqual([]);
        expect((await cms.outbox.pending()).length).toBe(0);
    });

    it('queues each scheduled occurrence once, even from two hosts', async () => {
        // 10:02:00 after the clock advanced: the next five-minute mark is 10:05.
        const planned = nextCronTime('*/5 * * * *', clock);
        expect(await cms.schedules.tick()).toEqual({ queued: [], skipped: [] });
        expect(await cms.schedules.list()).toMatchObject([{ id: 'desk:heartbeat', plugin: 'desk', name: 'heartbeat', cron: '*/5 * * * *', nextAt: planned, lastAt: null }]);
        clock = planned + 10_000;
        const twin = host();
        await twin.ready();
        const ticks = await Promise.all([cms.schedules.tick(), twin.schedules.tick()]);
        expect(ticks.flatMap(tick => tick.queued)).toEqual(['desk:heartbeat']);
        expect((await cms.schedules.list())[0]).toMatchObject({ nextAt: nextCronTime('*/5 * * * *', clock), lastAt: planned });
        const before = ran.length;
        await cms.outbox.dispatch({ limit: 10 });
        expect(ran.slice(before).filter(entry => entry.name === 'heartbeat')).toEqual([{ name: 'heartbeat', payload: { cron: '*/5 * * * *', scheduledAt: planned }, scheduledAt: planned }]);
        // Long after, the missed occurrence is skipped and the row planned ahead.
        clock += 3 * 60 * 60_000;
        const late = await cms.schedules.tick();
        expect(late).toEqual({ queued: [], skipped: ['desk:heartbeat'] });
        expect((await cms.schedules.list())[0]!.nextAt).toBeGreaterThan(clock);
    });

    it('refuses everything again after revocation and retries a job the plugin cannot run', async () => {
        expect(await context.jobs.enqueue('notify', { ticket: 9 })).toBe(true);
        await cms.revokePlugin('desk', admin);
        await expect(context.cache.get('k')).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        await expect(context.mail.send({ to: 'a@b.co', subject: 'x', text: 'y' })).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        const report = await cms.outbox.dispatch({ limit: 10 });
        expect(report.retrying.map(entry => entry.plugins)).toEqual([['desk']]);
        expect(await cms.schedules.tick()).toEqual({ queued: [], skipped: [] });
    });
});
