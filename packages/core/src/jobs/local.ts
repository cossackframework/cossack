import type { JobAdapter, JobClaim, JobClaimOptions, JobEnvelope, JobInspection, JobResult, JobStore } from './contracts';

interface RecordState { inspection: JobInspection; token?: string; expiresAt?: number; }
/** Process-only test ledger. Snapshot/restore simulates a restart; it is not durable infrastructure. */
export class MemoryJobStore implements JobStore {
    readonly durability = 'process' as const;
    private records = new Map<string, RecordState>();
    constructor(snapshot: readonly [string, RecordState][] = []) { this.records = new Map(structuredClone(snapshot)); }
    snapshot(): readonly [string, RecordState][] { return structuredClone([...this.records]); }
    async claim(key: string, options: JobClaimOptions): Promise<JobClaim> {
        const previous = this.records.get(key);
        if (previous?.inspection.status === 'completed' || previous?.inspection.status === 'failed') return { status: previous.inspection.status };
        if (previous && (previous.token || previous.inspection.status === 'retrying') && previous.expiresAt! > options.now) return { status: 'busy', retryAfterSeconds: Math.ceil((previous.expiresAt! - options.now) / 1000) };
        const token = crypto.randomUUID(); const attempt = (previous?.inspection.attempt ?? 0) + 1;
        this.records.set(key, { token, expiresAt: options.now + options.leaseMs, inspection: { key, job: options.job, status: 'running', attempt, updatedAt: options.now } });
        return { status: 'acquired', token, attempt };
    }
    async complete(key: string, token: string, now: number): Promise<boolean> {
        const state = this.records.get(key); if (!state || state.token !== token) return false;
        state.inspection = { ...state.inspection, status: 'completed', updatedAt: now };
        delete state.token; delete state.expiresAt; return true;
    }
    async fail(key: string, token: string, failure: Parameters<JobStore['fail']>[2]): Promise<boolean> {
        if (!Number.isFinite(failure.now) || !Number.isFinite(failure.retryAt) || failure.retryAt < failure.now || failure.retryAt - failure.now > 86400 * 1000) throw new Error('[Cossack] Invalid job retry deadline.');
        const state = this.records.get(key); if (!state || state.token !== token) return false;
        state.inspection = { ...state.inspection, status: failure.terminal ? 'failed' : 'retrying', updatedAt: failure.now, code: failure.code, action: failure.action };
        delete state.token;
        if (failure.terminal) delete state.expiresAt; else state.expiresAt = failure.retryAt;
        return true;
    }
    async inspect(options: Parameters<JobStore['inspect']>[0] = {}): Promise<readonly JobInspection[]> {
        const limit = options.limit ?? 100;
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('[Cossack] Job inspection limit must be between 1 and 1000.');
        return [...this.records.values()].map(record => ({ ...record.inspection })).filter(record => !options.status || record.status === options.status).sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key)).slice(0, limit);
    }
}
interface Pending { envelope: JobEnvelope; availableAt: number; attempt: number; order: number; }
/** Explicit clock advancement; no timers or background promises. */
export class LocalJobAdapter implements JobAdapter {
    readonly durability = 'process' as const;
    private pending: Pending[] = [];
    private order = 0;
    private time: number;
    constructor(now = 0) { this.time = now; }
    now = (): number => this.time;
    advance(seconds: number): void { if (!Number.isFinite(seconds) || seconds < 0) throw new Error('[Cossack] Invalid local job clock advance.'); this.time += seconds * 1000; }
    async publish(envelope: JobEnvelope, options: { delaySeconds: number }): Promise<void> { this.pending.push({ envelope: structuredClone(envelope), availableAt: this.time + options.delaySeconds * 1000, attempt: 1, order: this.order++ }); }
    snapshot(): readonly Pending[] { return structuredClone(this.pending); }
    restore(snapshot: readonly Pending[]): void { this.pending = structuredClone([...snapshot]); this.order = Math.max(0, ...this.pending.map(item => item.order + 1)); }
    async drain(runtime: { consume(envelope: unknown, attempt?: number): Promise<JobResult> }): Promise<readonly JobResult[]> {
        const due = this.pending.filter(item => item.availableAt <= this.time).sort((a, b) => a.availableAt - b.availableAt || a.order - b.order);
        this.pending = this.pending.filter(item => item.availableAt > this.time);
        const results: JobResult[] = [];
        for (const item of due) {
            try {
                const result = await runtime.consume(item.envelope, item.attempt); results.push(result);
                if (result.status === 'retry') this.pending.push({ ...item, attempt: item.attempt + 1, availableAt: this.time + result.delaySeconds * 1000, order: this.order++ });
            } catch { this.pending.push({ ...item, attempt: item.attempt + 1, availableAt: this.time + 5000, order: this.order++ }); results.push({ status: 'retry', delaySeconds: 5 }); }
        }
        return results;
    }
}
