import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createD1JobStore, jobStateSchema, type JobStateDatabase } from '../src/jobs/d1-store';
const key = 'a'.repeat(64);
function binding(database: DatabaseSync): JobStateDatabase {
    return { prepare(sql) { return { bind(...values) { const statement = database.prepare(sql); return {
        async first<T>() { return (statement.get(...values) ?? null) as T | null; },
        async all<T>() { return { results: statement.all(...values) as T[] }; },
        async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
    }; } }; } };
}
const claim = { now: 1000, leaseMs: 2000, job: 'send-report', attempt: 1 };
describe('durable D1 job ledger SQL', () => {
    it('atomically admits one overlapping claimant and fences old tokens after expiry', async () => {
        const db = new DatabaseSync(':memory:'); db.exec(jobStateSchema);
        try {
            const store = createD1JobStore(binding(db));
            const claims = await Promise.all([store.claim(key, claim), store.claim(key, claim)]);
            expect(claims.map(value => value.status)).toEqual(['acquired', 'busy']);
            const first = claims[0]; if (first.status !== 'acquired') throw Error('Missing claim');
            const second = await store.claim(key, { ...claim, now: 3001 });
            expect(second).toMatchObject({ status: 'acquired', attempt: 2 });
            if (second.status !== 'acquired') throw Error('Missing second claim');
            expect(await store.complete(key, first.token, 3002)).toBe(false);
            expect(await store.complete(key, second.token, 3002)).toBe(true);
            expect(await store.claim(key, { ...claim, now: 9000 })).toEqual({ status: 'completed' });
        } finally { db.close(); }
    });
    it('retains terminal completion across fresh connection and store instances', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'cossack-job-state-')); const file = join(directory, 'state.sqlite');
        let db = new DatabaseSync(file);
        try {
            db.exec(jobStateSchema); const store = createD1JobStore(binding(db)); const acquired = await store.claim(key, claim);
            if (acquired.status !== 'acquired') throw Error('Missing claim');
            expect(await store.complete(key, acquired.token, 1001)).toBe(true); db.close(); db = new DatabaseSync(file);
            expect(await createD1JobStore(binding(db)).claim(key, { ...claim, now: 9999 })).toEqual({ status: 'completed' });
        } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
    });
    it('owns attempt counts and exposes only actionable structural failure state', async () => {
        const db = new DatabaseSync(':memory:'); db.exec(jobStateSchema);
        try {
            const store = createD1JobStore(binding(db)); const first = await store.claim(key, { ...claim, attempt: 999 });
            expect(first).toMatchObject({ status: 'acquired', attempt: 1 }); if (first.status !== 'acquired') throw Error('Missing claim');
            expect(await store.fail(key, first.token, { terminal: false, now: 1001, retryAt: 1002, code: 'JOB_TRANSIENT_FAILURE', action: 'inspect-handler-and-provider' })).toBe(true);
            const second = await store.claim(key, { ...claim, now: 1002, attempt: 1 });
            expect(second).toMatchObject({ status: 'acquired', attempt: 2 }); if (second.status !== 'acquired') throw Error('Missing claim');
            expect(await store.fail(key, first.token, { terminal: true, now: 1003, retryAt: 1003, code: 'JOB_PERMANENT_FAILURE', action: 'fix-handler-and-dispatch-new-key' })).toBe(false);
            expect(await store.fail(key, second.token, { terminal: true, now: 1004, retryAt: 1004, code: 'JOB_RETRY_EXHAUSTED', action: 'fix-handler-and-dispatch-new-key' })).toBe(true);
            expect(await store.claim(key, { ...claim, now: 9000 })).toEqual({ status: 'failed' });
            expect(await store.inspect({ status: 'failed' })).toEqual([{ key, job: 'send-report', status: 'failed', attempt: 2, updatedAt: 1004, code: 'JOB_RETRY_EXHAUSTED', action: 'fix-handler-and-dispatch-new-key' }]);
        } finally { db.close(); }
    });
    it('inspection performs no schema setup writes and validates bounded options', async () => {
        const db = new DatabaseSync(':memory:');
        try {
            const store = createD1JobStore(binding(db)); await expect(store.inspect()).rejects.toThrow();
            expect(db.prepare("SELECT name FROM sqlite_master WHERE name='cossack_jobs'").get()).toBeUndefined();
            await expect(store.inspect({ limit: 1001 })).rejects.toThrow('Invalid job inspection');
            await expect(store.claim('not-a-key', claim)).rejects.toThrow('runtime-generated');
        } finally { db.close(); }
    });
});
it('retains retry backoff through fresh connections and does not count early duplicate deliveries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cossack-job-backoff-')); const file = join(directory, 'state.sqlite');
    let db = new DatabaseSync(file);
    try {
        db.exec(jobStateSchema); let store = createD1JobStore(binding(db)); const first = await store.claim(key, claim);
        if (first.status !== 'acquired') throw Error('Missing claim');
        await store.fail(key, first.token, { terminal: false, now: 1001, retryAt: 7001, code: 'JOB_TRANSIENT_FAILURE', action: 'inspect-handler-and-provider' });
        expect(await store.claim(key, { ...claim, now: 1002 })).toEqual({ status: 'busy', retryAfterSeconds: 6 });
        db.close(); db = new DatabaseSync(file); store = createD1JobStore(binding(db));
        expect(await store.claim(key, { ...claim, now: 6000 })).toEqual({ status: 'busy', retryAfterSeconds: 2 });
        expect((await store.inspect())[0]?.attempt).toBe(1);
        expect(await store.claim(key, { ...claim, now: 7001 })).toMatchObject({ status: 'acquired', attempt: 2 });
    } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});
