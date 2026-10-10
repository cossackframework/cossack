export interface JobSchema<T> { parse(value: unknown): Promise<T>; }
export interface JobScope { tenantId?: string; actorId?: string; }
export interface JobContext {
    readonly id: string;
    /** Stable logical identity, including namespace/job/tenant/actor/key. Use for effect receipts. */
    readonly key: string;
    readonly attempt: number;
    readonly scope: Readonly<JobScope>;
    onCleanup(callback: () => void | Promise<void>): void;
}
export interface JobDefinition<T> {
    schema: JobSchema<T>;
    handle(payload: T, context: JobContext): void | Promise<void>;
    maxAttempts?: number;
    retryDelaySeconds?: number;
}
export function defineJob<T>(definition: JobDefinition<T>): JobDefinition<T> { return definition; }
export type JobRegistry = Record<string, JobDefinition<any>>;
export type JobPayload<J> = J extends JobDefinition<infer T> ? T : never;
export interface JobEnvelope {
    version: 1;
    namespace: string;
    id: string;
    job: string;
    key: string;
    scope: JobScope;
    payload: unknown;
    createdAt: number;
}
export type JobFailureCode = 'JOB_PAYLOAD_INVALID' | 'JOB_PERMANENT_FAILURE' | 'JOB_RETRY_EXHAUSTED' | 'JOB_TRANSIENT_FAILURE' | 'JOB_CLEANUP_FAILED' | 'JOB_STORE_FAILED';
export interface JobInspection {
    key: string;
    job: string;
    status: 'running' | 'retrying' | 'completed' | 'failed';
    attempt: number;
    updatedAt: number;
    code?: JobFailureCode;
    action?: 'fix-payload' | 'fix-handler-and-dispatch-new-key' | 'inspect-handler-and-provider';
}
export interface JobClaimOptions { now: number; leaseMs: number; job: string; attempt: number; }
export type JobClaim = { status: 'acquired'; token: string; attempt: number } | { status: 'busy'; retryAfterSeconds: number } | { status: 'completed' | 'failed' };
/** All mutations must be atomic and fenced by the claim token. Durable stores retain
 * terminal keys across workers/restarts for the application's chosen retention period. */
export interface JobStore {
    readonly durability: 'process' | 'durable';
    claim(key: string, options: JobClaimOptions): Promise<JobClaim>;
    complete(key: string, token: string, now: number): Promise<boolean>;
    fail(key: string, token: string, failure: { terminal: boolean; now: number; retryAt: number; code: JobFailureCode; action: NonNullable<JobInspection['action']> }): Promise<boolean>;
    inspect(options?: { status?: JobInspection['status']; limit?: number }): Promise<readonly JobInspection[]>;
}
export interface JobAdapter {
    readonly durability: 'process' | 'durable';
    publish(envelope: JobEnvelope, options: { delaySeconds: number }): Promise<void>;
}
export type JobResult = { status: 'completed' | 'duplicate' | 'failed'; code?: JobFailureCode } | { status: 'retry'; delaySeconds: number; code?: JobFailureCode };
export class PermanentJobError extends Error { constructor() { super('The job failed permanently.'); this.name = 'PermanentJobError'; } }
export class TransientJobError extends Error { constructor() { super('The job requires another attempt.'); this.name = 'TransientJobError'; } }
