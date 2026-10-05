import { PermanentJobError, type JobAdapter, type JobContext, type JobEnvelope, type JobFailureCode, type JobInspection, type JobPayload, type JobRegistry, type JobResult, type JobScope, type JobStore } from './contracts';

function configuration(): never { throw new Error('[Cossack] Invalid job configuration. Check the registry, adapter, atomic store, and namespace.'); }
function integer(value: number, min: number, max: number): number { if (!Number.isInteger(value) || value < min || value > max) configuration(); return value; }
const NAME = /^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/;
/** Reject request objects, accessors, cycles, non-finite values, and non-JSON types. */
function serializable<T>(value: T): T {
    const ancestors = new Set<object>(); let nodes = 0;
    const visit = (current: unknown, depth: number): void => {
        if (++nodes > 4096 || depth > 32) configuration();
        if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
        if (typeof current === 'number' && Number.isFinite(current)) return;
        if (typeof current !== 'object' || ancestors.has(current)) configuration();
        if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) configuration();
        ancestors.add(current);
        for (const key of Reflect.ownKeys(current)) {
            if (Array.isArray(current) && key === 'length') continue;
            const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
            if (typeof key !== 'string' || !('value' in descriptor) || !descriptor.enumerable || ['__proto__', 'constructor', 'prototype'].includes(key)) configuration();
            visit(descriptor.value, depth + 1);
        }
        ancestors.delete(current);
    };
    visit(value, 0);
    const text = JSON.stringify(value);
    if (new TextEncoder().encode(text).length > 120 * 1024) configuration();
    return JSON.parse(text) as T;
}
function scopeValue(value: JobScope): JobScope {
    const scope = serializable(value);
    if (Object.keys(scope).some(key => !['tenantId', 'actorId'].includes(key))) configuration();
    for (const id of Object.values(scope)) if (typeof id !== 'string' || !id || id.length > 256) configuration();
    return scope;
}
async function digest(parts: readonly unknown[]): Promise<string> {
    const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
    return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}
export interface JobRuntimeOptions<J extends JobRegistry> {
    jobs: J; adapter: JobAdapter; store: JobStore; namespace: string;
    leaseMs?: number; now?: () => number;
    logger?: (event: JobInspection) => void;
}
export interface JobQueueMessage { readonly body: unknown; readonly attempts: number; ack(): void; retry(options: { delaySeconds: number }): void; }
export function createJobRuntime<J extends JobRegistry>(options: JobRuntimeOptions<J>) {
    if (!NAME.test(options.namespace) || !options.store || !options.adapter || (options.adapter.durability === 'durable' && options.store.durability !== 'durable')) configuration();
    const jobs = Object.assign(Object.create(null), options.jobs) as J;
    if (!Object.keys(jobs).length) configuration();
    for (const [name, job] of Object.entries(jobs)) {
        if (!NAME.test(name) || typeof job.schema?.parse !== 'function' || typeof job.handle !== 'function') configuration();
        integer(job.maxAttempts ?? 3, 1, 100); integer(job.retryDelaySeconds ?? 5, 1, 86400);
    }
    const now = options.now ?? Date.now;
    const leaseMs = integer(options.leaseMs ?? 900_000, 1000, 86_400_000);
    const emit = (event: JobInspection): void => { try { options.logger?.({ ...event }); } catch { /* Diagnostics never change delivery ownership. */ } };
    async function dispatch<K extends keyof J & string>(name: K, payload: JobPayload<J[K]>, config: { scope: JobScope; idempotencyKey?: string; delaySeconds?: number }): Promise<string> {
        const job = jobs[name]; if (!job) configuration();
        const scope = scopeValue(config.scope);
        const id = crypto.randomUUID();
        if (config.idempotencyKey !== undefined && (typeof config.idempotencyKey !== 'string' || !config.idempotencyKey || config.idempotencyKey.length > 512)) configuration();
        const key = await digest([options.namespace, name, scope.tenantId ?? null, scope.actorId ?? null, config.idempotencyKey ?? id]);
        const input = serializable(payload);
        let parsed: unknown;
        try { parsed = await job.schema.parse(input); } catch { throw new Error('[Cossack] Job payload validation failed. Check the registered payload schema.'); }
        const envelope: JobEnvelope = { version: 1, namespace: options.namespace, id, job: name, key, scope, payload: serializable(parsed), createdAt: now() };
        await options.adapter.publish(envelope, { delaySeconds: integer(config.delaySeconds ?? 0, 0, 86400) });
        return id;
    }
    async function consume(raw: unknown, attempt = 1): Promise<JobResult> {
        integer(attempt, 1, 1_000_000);
        const invalid = (): JobResult => { emit({ key: 'invalid-envelope', job: 'unknown', status: 'failed', attempt, updatedAt: now(), code: 'JOB_PAYLOAD_INVALID', action: 'fix-payload' }); return { status: 'failed', code: 'JOB_PAYLOAD_INVALID' }; };
        let envelope: JobEnvelope;
        try {
            envelope = serializable(raw) as JobEnvelope;
            if (envelope.version !== 1 || envelope.namespace !== options.namespace || !NAME.test(envelope.job) || !/^[a-f0-9]{64}$/.test(envelope.key) || typeof envelope.id !== 'string' || envelope.id.length > 128 || !Number.isFinite(envelope.createdAt)) configuration();
            envelope.scope = scopeValue(envelope.scope);
        } catch { return invalid(); }
        const job = jobs[envelope.job];
        if (!job) return invalid();
        const claim = await options.store.claim(envelope.key, { now: now(), leaseMs, job: envelope.job, attempt });
        if (claim.status === 'busy') return { status: 'retry', delaySeconds: Math.max(1, Math.min(86400, Math.ceil(claim.retryAfterSeconds))) };
        if (claim.status !== 'acquired') return { status: 'duplicate' };
        attempt = integer(claim.attempt, 1, 1_000_000);
        const cleanups: Array<() => void | Promise<void>> = [];
        let failure: JobFailureCode | undefined;
        let permanent = false;
        let handlerCompleted = false;
        let active = true;
        const context: JobContext = { id: envelope.id, key: envelope.key, attempt, scope: Object.freeze({ ...envelope.scope }), onCleanup(callback) { if (!active || typeof callback !== 'function') configuration(); cleanups.push(callback); } };
        try {
            if (attempt > (job.maxAttempts ?? 3)) { failure = 'JOB_RETRY_EXHAUSTED'; permanent = true; }
            else {
                let payload: unknown;
                try { payload = serializable(await job.schema.parse(envelope.payload)); } catch { failure = 'JOB_PAYLOAD_INVALID'; permanent = true; }
                if (!failure) {
                    try { await job.handle(payload, context); handlerCompleted = true; }
                    catch (error) { permanent = error instanceof PermanentJobError; failure = permanent ? 'JOB_PERMANENT_FAILURE' : 'JOB_TRANSIENT_FAILURE'; }
                }
            }
        } finally {
            active = false;
            for (const cleanup of cleanups.reverse()) { try { await cleanup(); } catch { failure ??= 'JOB_CLEANUP_FAILED'; } }
        }
        if (!failure) {
            if (!await options.store.complete(envelope.key, claim.token, now())) return { status: 'retry', delaySeconds: job.retryDelaySeconds ?? 5 };
            emit({ key: envelope.key, job: envelope.job, status: 'completed', attempt, updatedAt: now() });
            return { status: 'completed' };
        }
        const cleanupAfterEffect = handlerCompleted && failure === 'JOB_CLEANUP_FAILED';
        const terminal = permanent || cleanupAfterEffect || attempt >= (job.maxAttempts ?? 3);
        if (terminal && !permanent && !cleanupAfterEffect && failure !== 'JOB_PAYLOAD_INVALID') failure = 'JOB_RETRY_EXHAUSTED';
        const action = failure === 'JOB_PAYLOAD_INVALID' ? 'fix-payload' : terminal ? 'fix-handler-and-dispatch-new-key' : 'inspect-handler-and-provider';
        const failedAt = now();
        const retryAt = terminal ? failedAt : failedAt + (job.retryDelaySeconds ?? 5) * 1000;
        if (!await options.store.fail(envelope.key, claim.token, { terminal, now: failedAt, retryAt, code: failure, action })) return { status: 'retry', delaySeconds: job.retryDelaySeconds ?? 5 };
        emit({ key: envelope.key, job: envelope.job, status: terminal ? 'failed' : 'retrying', attempt, updatedAt: now(), code: failure, action });
        return terminal ? { status: 'failed', code: failure } : { status: 'retry', delaySeconds: job.retryDelaySeconds ?? 5, code: failure };
    }
    async function queue(batch: { readonly messages: readonly JobQueueMessage[] }): Promise<void> {
        // Each message owns its outcome; a failed store cannot acknowledge unrecorded work.
        for (const message of batch.messages) {
            try { const result = await consume(message.body, message.attempts); if (result.status === 'retry') message.retry({ delaySeconds: result.delaySeconds }); else message.ack(); }
            catch { emit({ key: 'unavailable', job: 'unknown', status: 'retrying', attempt: Number.isInteger(message.attempts) ? message.attempts : 1, updatedAt: now(), code: 'JOB_STORE_FAILED', action: 'inspect-handler-and-provider' }); message.retry({ delaySeconds: 5 }); }
        }
    }
    return { dispatch, consume, queue, inspect: (config?: Parameters<JobStore['inspect']>[0]) => options.store.inspect(config) };
}
