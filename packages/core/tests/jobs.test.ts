import { expect, it } from 'vitest';
import { input } from '../src/input';
import { createJobRuntime, defineJob, LocalJobAdapter, MemoryJobStore, PermanentJobError, TransientJobError, createCloudflareJobAdapter } from '../src/jobs';

const schema = input.object({ value: input.string({ required: true }) });
function fixture(handle: (payload: { value: string }, context: any) => void | Promise<void>, settings: { maxAttempts?: number; retryDelaySeconds?: number } = {}) {
    const adapter = new LocalJobAdapter(); const store = new MemoryJobStore();
    const jobs = { notify: defineJob({ schema, handle, ...settings }) };
    const runtime = createJobRuntime({ jobs, adapter, store, namespace: 'staging', now: adapter.now });
    return { adapter, store, jobs, runtime };
}
const scope = { tenantId: 'PRIVATE_TENANT', actorId: 'PRIVATE_ACTOR' };
it('deduplicates concurrent and redelivered work while namespacing tenant, actor, job, and environment', async () => {
    let effects = 0; let release!: () => void;
    const f = fixture(async (_payload, context) => { expect(context.scope).toEqual(scope); effects++; await new Promise<void>(resolve => { release = resolve; }); });
    await f.runtime.dispatch('notify', { value: 'PRIVATE_PAYLOAD' }, { scope, idempotencyKey: 'PRIVATE_KEY' });
    const envelope = f.adapter.snapshot()[0]!.envelope;
    const first = f.runtime.consume(envelope); await expect.poll(() => effects).toBe(1);
    expect((await f.runtime.consume(envelope)).status).toBe('retry'); release(); expect((await first).status).toBe('completed');
    expect((await f.runtime.consume(envelope, 999)).status).toBe('duplicate'); expect(effects).toBe(1);
    for (const selected of [scope, { ...scope, tenantId: 'other' }, { ...scope, actorId: 'other' }]) await f.runtime.dispatch('notify', { value: 'another' }, { scope: selected, idempotencyKey: 'PRIVATE_KEY' });
    const keys = f.adapter.snapshot().map(item => item.envelope.key); expect(keys[0]).toBe(keys[1]); expect(new Set(keys).size).toBe(3);
    const other = createJobRuntime({ jobs: { second: f.jobs.notify }, adapter: f.adapter, store: f.store, namespace: 'production', now: f.adapter.now });
    await other.dispatch('second', { value: 'another' }, { scope, idempotencyKey: 'PRIVATE_KEY' }); expect(new Set(f.adapter.snapshot().map(item => item.envelope.key)).size).toBe(4);
});
it('honors dispatch and transient retry delays with deterministic clock advancement', async () => {
    let effects = 0; const f = fixture(() => { if (++effects === 1) throw new TransientJobError(); }, { retryDelaySeconds: 7 });
    await f.runtime.dispatch('notify', { value: 'test' }, { scope, delaySeconds: 10 });
    expect(await f.adapter.drain(f.runtime)).toEqual([]); f.adapter.advance(9); expect(await f.adapter.drain(f.runtime)).toEqual([]);
    f.adapter.advance(1); expect(await f.adapter.drain(f.runtime)).toMatchObject([{ status: 'retry', delaySeconds: 7 }]);
    f.adapter.advance(6); expect(await f.adapter.drain(f.runtime)).toEqual([]); f.adapter.advance(1);
    expect(await f.adapter.drain(f.runtime)).toEqual([{ status: 'completed' }]); expect(effects).toBe(2);
});
it.each([true, false])('classifies permanent errors and exhausted transient failures, permanent=%s', async permanent => {
    let attempts = 0; const f = fixture(() => { attempts++; throw permanent ? new PermanentJobError() : Error('PRIVATE_EXCEPTION'); }, { maxAttempts: 2 });
    await f.runtime.dispatch('notify', { value: 'PRIVATE_PAYLOAD' }, { scope });
    await f.adapter.drain(f.runtime); f.adapter.advance(5); await f.adapter.drain(f.runtime); f.adapter.advance(5); await f.adapter.drain(f.runtime);
    expect(attempts).toBe(permanent ? 1 : 2);
    const records = await f.runtime.inspect({ status: 'failed' }); expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ code: permanent ? 'JOB_PERMANENT_FAILURE' : 'JOB_RETRY_EXHAUSTED', action: 'fix-handler-and-dispatch-new-key' });
    expect(JSON.stringify(records)).not.toContain('PRIVATE_');
});
it('awaits every cleanup after failed hooks and never automatically repeats successful effects', async () => {
    const order: string[] = []; let effects = 0;
    const f = fixture((_payload, context) => { effects++; context.onCleanup(async () => { await Promise.resolve(); order.push('first'); }); context.onCleanup(() => { order.push('second'); throw Error('PRIVATE_CLEANUP'); }); });
    await f.runtime.dispatch('notify', { value: 'test' }, { scope });
    expect(await f.adapter.drain(f.runtime)).toEqual([{ status: 'failed', code: 'JOB_CLEANUP_FAILED' }]); expect(order).toEqual(['second', 'first']);
    f.adapter.advance(100); expect(await f.adapter.drain(f.runtime)).toEqual([]); expect(effects).toBe(1);
});
it('cleans up unsuccessful handlers on every retry', async () => {
    let cleanups = 0; const f = fixture((_payload, context) => { context.onCleanup(() => { cleanups++; }); throw Error('PRIVATE'); }, { maxAttempts: 2 });
    await f.runtime.dispatch('notify', { value: 'test' }, { scope }); await f.adapter.drain(f.runtime); f.adapter.advance(5); await f.adapter.drain(f.runtime); expect(cleanups).toBe(2);
});
it('revalidates delivered payloads before effects and records redacted actionable permanent rejection', async () => {
    let effects = 0; const f = fixture(() => { effects++; });
    await expect(f.runtime.dispatch('notify', { value: '' }, { scope })).rejects.toThrow('payload validation'); expect(f.adapter.snapshot()).toHaveLength(0);
    await f.runtime.dispatch('notify', { value: 'valid' }, { scope }); const envelope = f.adapter.snapshot()[0]!.envelope;
    expect(await f.runtime.consume({ ...envelope, payload: { value: '' } })).toEqual({ status: 'failed', code: 'JOB_PAYLOAD_INVALID' }); expect(effects).toBe(0);
    expect(await f.runtime.inspect()).toMatchObject([{ status: 'failed', code: 'JOB_PAYLOAD_INVALID', action: 'fix-payload' }]);
    expect(await f.runtime.consume({ ...envelope, job: 'unregistered' })).toEqual({ status: 'failed', code: 'JOB_PAYLOAD_INVALID' });
    expect(await f.runtime.consume({ ...envelope, namespace: 'production' })).toEqual({ status: 'failed', code: 'JOB_PAYLOAD_INVALID' });
});
it('rejects request retention, accessors, non-JSON scope and invalid delay configuration', async () => {
    const f = fixture(() => {}); let accessed = false;
    const evil = { get tenantId() { accessed = true; return 'bad'; } };
    await expect(f.runtime.dispatch('notify', { value: 'valid' }, { scope: evil })).rejects.toThrow('configuration'); expect(accessed).toBe(false);
    await expect(f.runtime.dispatch('notify', { value: 'valid' }, { scope: new Request('https://example.com') as any })).rejects.toThrow('configuration');
    await expect(f.runtime.dispatch('notify', { value: 'valid' }, { scope, delaySeconds: 86401 })).rejects.toThrow('configuration'); expect(f.adapter.snapshot()).toHaveLength(0);
});
it('restores completion and retry attempt counts when worker objects restart and provider attempts reset', async () => {
    let effects = 0; const f = fixture(() => { effects++; throw Error('PRIVATE'); }, { maxAttempts: 2 });
    await f.runtime.dispatch('notify', { value: 'test' }, { scope }); const envelope = f.adapter.snapshot()[0]!.envelope;
    expect((await f.runtime.consume(envelope, 1)).status).toBe('retry');
    const restored = new MemoryJobStore(f.store.snapshot());
    const restarted = createJobRuntime({ jobs: f.jobs, adapter: f.adapter, store: restored, namespace: 'staging', now: f.adapter.now });
    expect(await restarted.consume(envelope, 1)).toEqual({ status: 'retry', delaySeconds: 5 }); expect(effects).toBe(1);
    expect((await restarted.inspect())[0]!.attempt).toBe(1);
    f.adapter.advance(5);
    expect(await restarted.consume(envelope, 1)).toEqual({ status: 'failed', code: 'JOB_RETRY_EXHAUSTED' }); expect(effects).toBe(2);
    const again = createJobRuntime({ jobs: f.jobs, adapter: f.adapter, store: new MemoryJobStore(restored.snapshot()), namespace: 'staging', now: f.adapter.now });
    expect((await again.consume(envelope, 1)).status).toBe('duplicate'); expect(effects).toBe(2);
});
it('persists retry backoff against duplicate deliveries without incrementing attempts', async () => {
    let effects = 0; const f = fixture(() => { if (++effects === 1) throw new TransientJobError(); }, { retryDelaySeconds: 10 });
    await f.runtime.dispatch('notify', { value: 'test' }, { scope }); const envelope = f.adapter.snapshot()[0]!.envelope;
    expect(await f.runtime.consume(envelope)).toMatchObject({ status: 'retry', delaySeconds: 10 });
    for (let index = 0; index < 3; index++) expect(await f.runtime.consume(envelope, 999)).toEqual({ status: 'retry', delaySeconds: 10 });
    expect(effects).toBe(1); expect((await f.runtime.inspect())[0]!.attempt).toBe(1);
    f.adapter.advance(9); expect(await f.runtime.consume(envelope)).toEqual({ status: 'retry', delaySeconds: 1 }); expect(effects).toBe(1);
    f.adapter.advance(1); expect(await f.runtime.consume(envelope, 1)).toEqual({ status: 'completed' }); expect(effects).toBe(2);
});
it('rejects invalid retry deadlines before mutating an owned claim', async () => {
    const store = new MemoryJobStore(); const claim = await store.claim('key', { now: 1000, leaseMs: 1000, job: 'notify', attempt: 1 });
    if (claim.status !== 'acquired') throw Error('claim');
    for (const retryAt of [NaN, Infinity, 999, 86400 * 1000 + 1001]) await expect(store.fail('key', claim.token, { terminal: false, now: 1000, retryAt, code: 'JOB_TRANSIENT_FAILURE', action: 'inspect-handler-and-provider' })).rejects.toThrow('deadline');
    expect((await store.inspect())[0]!.status).toBe('running');
});
it('preserves completed logical keys when both queue and ledger are restored', async () => {
    let effects = 0; const f = fixture(() => { effects++; });
    await f.runtime.dispatch('notify', { value: 'test' }, { scope, idempotencyKey: 'stable' });
    const queueSnapshot = f.adapter.snapshot(); await f.adapter.drain(f.runtime);
    const adapter = new LocalJobAdapter(); adapter.restore(queueSnapshot);
    const restarted = createJobRuntime({ jobs: f.jobs, adapter, store: new MemoryJobStore(f.store.snapshot()), namespace: 'staging', now: adapter.now });
    expect(await adapter.drain(restarted)).toEqual([{ status: 'duplicate' }]); expect(effects).toBe(1);
});
it('emits only fixed malformed-message state and keeps observer failures out of execution', async () => {
    const f = fixture(() => {}); const events: unknown[] = [];
    const runtime = createJobRuntime({ jobs: f.jobs, adapter: f.adapter, store: f.store, namespace: 'staging', now: f.adapter.now, logger(event) { events.push(event); throw Error('PRIVATE_OBSERVER'); } });
    expect(await runtime.consume({ secret: 'PRIVATE_INPUT' })).toEqual({ status: 'failed', code: 'JOB_PAYLOAD_INVALID' });
    await runtime.dispatch('notify', { value: 'PRIVATE_PAYLOAD' }, { scope }); expect(await f.adapter.drain(runtime)).toEqual([{ status: 'completed' }]);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_'); expect(events).toMatchObject([{ job: 'unknown', code: 'JOB_PAYLOAD_INVALID', action: 'fix-payload' }, { job: 'notify', status: 'completed' }]);
});
it('fences expired claims, retains terminal keys and returns detached bounded inspection', async () => {
    const store = new MemoryJobStore(); const options = { now: 0, leaseMs: 1000, job: 'notify', attempt: 999 };
    const first = await store.claim('key', options); if (first.status !== 'acquired') throw Error('claim');
    expect(first.attempt).toBe(1); expect((await store.claim('key', options)).status).toBe('busy');
    const second = await store.claim('key', { ...options, now: 1000 }); if (second.status !== 'acquired') throw Error('claim');
    expect(second.attempt).toBe(2); expect(await store.complete('key', first.token, 1001)).toBe(false);
    expect(await store.complete('key', second.token, 1001)).toBe(true); expect((await store.claim('key', { ...options, now: 99999 })).status).toBe('completed');
    const results = await store.inspect({ limit: 1 }); (results[0] as any).status = 'failed'; expect((await store.inspect())[0]!.status).toBe('completed'); await expect(store.inspect({ limit: 1001 })).rejects.toThrow('limit');
});
it('requires durable atomic storage for Cloudflare and awaits send with provider delay options', async () => {
    const sent: unknown[] = []; const adapter = createCloudflareJobAdapter({ async send(body, options) { sent.push({ body, options }); } });
    const f = fixture(() => {});
    expect(() => createJobRuntime({ jobs: f.jobs, adapter, store: f.store, namespace: 'staging' })).toThrow('atomic store');
    // Structural test stub explicitly declares durability; production must implement real persistence.
    const store = Object.assign(f.store, { durability: 'durable' as const });
    const runtime = createJobRuntime({ jobs: f.jobs, adapter, store, namespace: 'staging' });
    await runtime.dispatch('notify', { value: 'test' }, { scope, delaySeconds: 20 }); expect(sent).toMatchObject([{ options: { contentType: 'json', delaySeconds: 20 } }]);
});
it('acks terminal messages independently and retries store failures without exposing exceptions', async () => {
    const f = fixture(() => {}); await f.runtime.dispatch('notify', { value: 'test' }, { scope }); const envelope = f.adapter.snapshot()[0]!.envelope;
    let ack = 0; const retries: number[] = [];
    const message = (body: unknown) => ({ body, attempts: 1, ack() { ack++; }, retry(options: { delaySeconds: number }) { retries.push(options.delaySeconds); } });
    await f.runtime.queue({ messages: [message(envelope), message(envelope), message({ secret: 'PRIVATE' })] }); expect(ack).toBe(3);
    const broken = createJobRuntime({ jobs: f.jobs, adapter: f.adapter, namespace: 'staging', store: { ...f.store, durability: 'process', async claim() { throw Error('PRIVATE_STORE'); }, complete: f.store.complete.bind(f.store), fail: f.store.fail.bind(f.store), inspect: f.store.inspect.bind(f.store) } });
    await broken.queue({ messages: [message(envelope)] }); expect(retries).toEqual([5]); expect(ack).toBe(3);
});
it('does not lose later local deliveries when one store operation fails', async () => {
    const f = fixture(() => {}); for (let index = 0; index < 2; index++) await f.runtime.dispatch('notify', { value: 'test' }, { scope });
    let calls = 0; expect(await f.adapter.drain({ async consume() { if (++calls === 1) throw Error('PRIVATE'); return { status: 'completed' }; } })).toEqual([{ status: 'retry', delaySeconds: 5 }, { status: 'completed' }]); expect(f.adapter.snapshot()).toHaveLength(1);
});
// This function is compiled but never executed; errors prove the public payload contract.
function payloadTypeContract() {
    const f = fixture(() => {});
    void f.runtime.dispatch('notify', { value: 'valid' }, { scope });
    // @ts-expect-error Unknown job names are rejected statically.
    void f.runtime.dispatch('missing', { value: 'valid' }, { scope });
    // @ts-expect-error Payload must match the registered schema.
    void f.runtime.dispatch('notify', { value: 123 }, { scope });
    // @ts-expect-error Explicit serializable scope is required.
    void f.runtime.dispatch('notify', { value: 'valid' }, {});
}
void payloadTypeContract;
