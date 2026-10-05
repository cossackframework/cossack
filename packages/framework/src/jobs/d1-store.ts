import type { JobClaim, JobClaimOptions, JobFailureCode, JobInspection, JobStore } from '@cossackframework/core/jobs';

/** Narrow structural D1 interface; the application uses its Wrangler-generated bindings. */
export interface JobStateDatabase {
    prepare(sql: string): {
        bind(...values: (string | number | null)[]): {
            first<T>(): Promise<T | null>;
            all<T>(): Promise<{ results: T[] }>;
            run(): Promise<{ meta: { changes?: number } }>;
        };
    };
}
/** Apply explicitly during setup/migration, never during read-only inspection. */
export const jobStateSchema = `CREATE TABLE IF NOT EXISTS cossack_jobs (
    key TEXT PRIMARY KEY, job TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('running','retrying','completed','failed')),
    attempt INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    lease_until INTEGER NOT NULL, token TEXT NOT NULL,
    code TEXT, action TEXT
);
CREATE INDEX IF NOT EXISTS cossack_jobs_status ON cossack_jobs(status, updated_at);`;
interface StateRow {
    key: string; job: string; status: JobInspection['status']; attempt: number;
    updated_at: number; lease_until: number; code: JobFailureCode | null; action: JobInspection['action'] | null;
}
function assertKey(key: string): void {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new TypeError('Job state requires a runtime-generated key.');
}
/** Durable atomic ledger shared across Worker instances. Terminal keys persist until
 * an application-owned retention migration removes them. Expired running leases
 * can be reclaimed; external side effects must independently honor idempotency. */
export function createD1JobStore(database: JobStateDatabase): JobStore {
    if (!database || typeof database.prepare !== 'function') throw new TypeError('A D1 job state binding is required.');
    return {
        durability: 'durable',
        async claim(key: string, options: JobClaimOptions): Promise<JobClaim> {
            assertKey(key);
            if (!Number.isSafeInteger(options.now) || !Number.isSafeInteger(options.leaseMs) || options.leaseMs <= 0 ||
                !/^[A-Za-z0-9_.-]{1,128}$/.test(options.job)) throw new TypeError('Invalid job state claim.');
            const token = crypto.randomUUID();
            const acquired = await database.prepare(`INSERT INTO cossack_jobs
                (key,job,status,attempt,updated_at,lease_until,token) VALUES (?,?,'running',1,?,?,?)
                ON CONFLICT(key) DO UPDATE SET status='running', attempt=cossack_jobs.attempt+1,
                updated_at=excluded.updated_at, lease_until=excluded.lease_until, token=excluded.token, code=NULL, action=NULL
                WHERE cossack_jobs.status IN ('retrying','running') AND cossack_jobs.lease_until<=excluded.updated_at
                RETURNING attempt`).bind(key, options.job, options.now, options.now + options.leaseMs, token).first<{ attempt: number }>();
            if (acquired) return { status: 'acquired', token, attempt: acquired.attempt };
            const row = await database.prepare('SELECT status,lease_until FROM cossack_jobs WHERE key=?').bind(key).first<Pick<StateRow, 'status' | 'lease_until'>>();
            if (row?.status === 'completed' || row?.status === 'failed') return { status: row.status };
            return { status: 'busy', retryAfterSeconds: Math.max(1, Math.min(86400, Math.ceil(((row?.lease_until ?? options.now + 1000) - options.now) / 1000))) };
        },
        async complete(key, token, now) {
            assertKey(key);
            const result = await database.prepare("UPDATE cossack_jobs SET status='completed',updated_at=?,lease_until=0,code=NULL,action=NULL WHERE key=? AND token=? AND status='running'").bind(now, key, token).run();
            return result.meta.changes === 1;
        },
        async fail(key, token, failure) {
            assertKey(key);
            const result = await database.prepare("UPDATE cossack_jobs SET status=?,updated_at=?,lease_until=?,code=?,action=? WHERE key=? AND token=? AND status='running'")
                .bind(failure.terminal ? 'failed' : 'retrying', failure.now, failure.terminal ? 0 : failure.retryAt, failure.code, failure.action, key, token).run();
            return result.meta.changes === 1;
        },
        async inspect(options = {}) {
            const limit = options.limit ?? 100;
            if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || options.status !== undefined && !['running','retrying','completed','failed'].includes(options.status)) throw new TypeError('Invalid job inspection options.');
            const filtered = options.status !== undefined;
            const sql = `SELECT key,job,status,attempt,updated_at,code,action FROM cossack_jobs ${filtered ? 'WHERE status=? ' : ''}ORDER BY updated_at DESC,key LIMIT ?`;
            const rows = await database.prepare(sql).bind(...(filtered ? [options.status!, limit] : [limit])).all<StateRow>();
            return rows.results.map(row => ({ key: row.key, job: row.job, status: row.status, attempt: row.attempt,
                updatedAt: row.updated_at, ...(row.code ? { code: row.code } : {}), ...(row.action ? { action: row.action } : {}) }));
        },
    };
}
