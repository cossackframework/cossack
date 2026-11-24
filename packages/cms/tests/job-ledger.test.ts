/**
 * The job and notification ledgers on RomeDB (requests.md A1): a CMS project keeps them in its
 * RomeDB database through `rqlDatabase`, with no D1 binding. The stores take the facade as it is.
 */
import { describe, expect, it } from 'vitest';
import { rqlDatabase } from '@cossackframework/romedb';
import { createSqlJobStore, jobStateSchema, type JobStateDatabase } from '@cossackframework/core/jobs';
import { createSqlNotificationStore, notificationStateSchema, type NotificationStateDatabase } from '@cossackframework/core/notifications';
import { live, romedbService } from './helpers';

const KEY = 'b'.repeat(64);

describe.skipIf(!live)('job ledger on RomeDB', () => {
    const service = romedbService();

    it('creates its tables on first use and runs the job and notification stores', async () => {
        const ledger = rqlDatabase(service.database(), { kind: 'jobs', schema: [
            jobStateSchema,
            'CREATE TABLE IF NOT EXISTS cossack_job_receipts (key TEXT PRIMARY KEY, tenant TEXT NOT NULL, actor TEXT NOT NULL, value TEXT NOT NULL)',
            notificationStateSchema,
        ] });
        // No cast: the facade is what the stores take.
        const jobsDatabase: JobStateDatabase = ledger;
        const notificationsDatabase: NotificationStateDatabase = ledger;
        const jobs = createSqlJobStore(jobsDatabase);
        const claim = await jobs.claim(KEY, { job: 'record', now: 1_000, leaseMs: 60_000, attempt: 1 });
        expect(claim).toMatchObject({ status: 'acquired', attempt: 1 });
        expect(await jobs.claim(KEY, { job: 'record', now: 2_000, leaseMs: 60_000, attempt: 2 })).toMatchObject({ status: 'busy' });
        expect(await jobs.complete(KEY, (claim as { token: string }).token, 3_000)).toBe(true);
        expect(await jobs.inspect({ status: 'completed' })).toEqual([expect.objectContaining({ key: KEY, status: 'completed', attempt: 1 })]);
        // The example job's receipt: one per key.
        for (let i = 0; i < 2; i++) await ledger.prepare('INSERT INTO cossack_job_receipts (key,tenant,actor,value) VALUES (?,?,?,?) ON CONFLICT (key) DO NOTHING').bind(KEY, 't', 'a', 'v').run();
        expect((await ledger.prepare('SELECT count(*) AS n FROM cossack_job_receipts').bind().first<{ n: number }>())?.n).toBe(1);

        const notifications = createSqlNotificationStore(notificationsDatabase);
        const value = { id: 'n1', key: 'a'.repeat(64), recipient: { tenantId: 't', userId: 'u' }, channel: 'in-app' as const, template: 'notice', data: { title: 'Hi', body: 'There' },
            status: 'queued' as const, attempt: 0, read: false, createdAt: 1_000, updatedAt: 1_000 };
        const first = await notifications.insert(value as never);
        expect(first.created).toBe(true);
        expect((await notifications.insert(value as never)).created).toBe(false);
        expect(await notifications.get('n1')).toMatchObject({ id: 'n1', status: 'queued', read: false });
    });
});
