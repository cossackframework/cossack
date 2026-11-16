import { beforeAll, describe, expect, it } from 'vitest';
import { createHookRegistry } from '@cossackframework/core/hooks';
import { createCMS, type CmsHost } from '../src/server/index';
import { CmsWebhooks } from '../src/server/webhooks';
import { Outbox } from '../src/server/outbox';
import { pluginJob } from '../src/hooks';
import { live, romedbService } from './helpers';

// A dispatcher works through its batch one row at a time. When the batch outlasts its lease,
// another dispatcher claims the rest; the first must not send or run those rows again.
describe.skipIf(!live)('dispatch leases', () => {
    const service = romedbService();
    let cms: CmsHost;
    beforeAll(async () => { cms = createCMS({ db: service.database() }); expect((await cms.migrate()).failed).toBeUndefined(); });

    it('sends each webhook delivery once when a slow batch outlasts its lease', async () => {
        let clock = Date.now();
        const sent: string[] = [];
        let second: Promise<unknown> | undefined;
        const hooks: CmsWebhooks = new CmsWebhooks(cms.db, { now: () => clock, fetch: async (_input, init) => {
            sent.push(JSON.parse(String(init?.body)).eventId);
            clock += 9_000;
            // Seven sends in, the batch lease (60 s) has run out and another dispatcher starts.
            if (!second && sent.length === 7) { second = hooks.dispatch({ limit: 50 }); await second; }
            return new Response('ok');
        } });
        await hooks.save({ name: 'Slow receiver', url: 'https://example.test/hook', events: ['entry.published'] });
        for (let i = 1; i <= 8; i++) await hooks.enqueue({ event: 'entry.published', collection: 'posts', eventId: `event-${i}`, at: clock });
        await hooks.dispatch();
        expect(second).toBeDefined();
        expect(sent.sort()).toEqual(Array.from({ length: 8 }, (_, i) => `event-${i + 1}`).sort());
    });

    it('runs each outbox row once when slow handlers outlast the batch lease', async () => {
        let clock = Date.now();
        const ran: string[] = [];
        let second: Promise<unknown> | undefined;
        const registry = createHookRegistry();
        const outbox = new Outbox(cms.db, registry, { now: () => clock, leaseMs: 60_000 });
        registry.addAction(pluginJob, async event => {
            ran.push(event.eventId);
            clock += 40_000;
            if (!second && ran.length === 2) { second = outbox.dispatch(); await second; }
        }, { plugin: 'slow' });
        for (let i = 1; i <= 5; i++) await outbox.enqueue('plugin.job', { eventId: `job-${i}`, at: clock - 10 + i });
        await outbox.dispatch();
        expect(second).toBeDefined();
        expect(ran.sort()).toEqual(['job-1', 'job-2', 'job-3', 'job-4', 'job-5']);
    });
});
