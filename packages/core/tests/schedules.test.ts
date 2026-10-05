import { expect, it } from 'vitest';
import { input } from '../src/input';
import { createJobRuntime, defineJob, LocalJobAdapter, MemoryJobStore, TransientJobError } from '../src/jobs';
import { createScheduleRuntime, validateScheduleCron, validateScheduleDefinitions } from '../src/schedules';

const definition = { name: 'daily-report', cron: '0 9 * * MON-FRI', job: 'report', payload: { title: 'PRIVATE_PAYLOAD' }, scope: { tenantId: 'PRIVATE_TENANT', actorId: 'PRIVATE_ACTOR' } } as const;
it.each(['* * * * *', '*/30 0-23/2 1,15 JAN,aug SUN,7', '10 7 * * mon-fri', '0/15 * * * *', '59 23 31 12 7'])('validates conservative five-field UTC cron: %s', expression => {
    expect(validateScheduleCron(expression)).toBe(expression.toUpperCase());
});
it.each(['* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '* * * * 0', '* * * * 8', '*/0 * * * *', '*/61 * * * *', '1-0 * * * *', '* * * * FRI-MON', '* * L * *', '* * 1W * *', '* * * * MON#2', '? * * * *', '@daily', '0,,1 * * * *', '* * * UNKNOWN *', '1/2/3 * * * *'])('rejects unsupported/invalid cron without echoing it: %s', expression => {
    expect(() => validateScheduleCron(expression)).toThrow('Invalid schedule definition');
});
it('validates static JSON definitions, detaches values, and does not read accessors', () => {
    const authored = { ...definition, payload: { title: 'original' }, cron: '  0  9 * * mon-fri  ' };
    const copy = validateScheduleDefinitions([authored]); expect(copy[0]!.cron).toBe('0 9 * * MON-FRI');
    authored.payload.title = 'mutated'; expect((copy[0]!.payload as any).title).toBe('original');
    let read = false; expect(() => validateScheduleDefinitions([{ ...definition, get payload() { read = true; return {}; } }])).toThrow('Invalid schedule'); expect(read).toBe(false);
    for (const invalid of [[definition, definition], [{ ...definition, name: 'bad name' }], [{ ...definition, scope: undefined }], [{ ...definition, scope: { request: 'PRIVATE' } }], [{ ...definition, payload: new Request('https://example.com') }], [{ ...definition, payload: Infinity }], [{ ...definition, extra: 'PRIVATE' }], [{ ...definition, job: '' }]]) expect(() => validateScheduleDefinitions(invalid)).toThrow('Invalid schedule');
    const cycle: any = {}; cycle.self = cycle; expect(() => validateScheduleDefinitions([{ ...definition, payload: cycle }])).toThrow('Invalid schedule');
    expect(() => validateScheduleDefinitions([{ ...definition, payload: new Array(2) }])).toThrow('Invalid schedule');
});
it('rejects inherited array serialization hooks and additional array properties without invoking them', () => {
    let serializations = 0;
    class AuthoredArray extends Array<unknown> { toJSON() { serializations++; return []; } }
    expect(() => validateScheduleDefinitions(new AuthoredArray(definition))).toThrow('Invalid schedule');
    expect(() => validateScheduleDefinitions([{ ...definition, payload: new AuthoredArray('private') }])).toThrow('Invalid schedule');
    const extra = ['valid']; Object.defineProperty(extra, 'extra', { value: 'PRIVATE_NORMALIZED_AWAY', enumerable: true });
    expect(() => validateScheduleDefinitions([{ ...definition, payload: extra }])).toThrow('Invalid schedule');
    const registry = [definition]; Object.defineProperty(registry, 'extra', { value: 'PRIVATE_REGISTRY_VALUE', enumerable: true });
    expect(() => validateScheduleDefinitions(registry)).toThrow('Invalid schedule');
    let reads = 0; const accessor = ['valid']; Object.defineProperty(accessor, '0', { get() { reads++; return 'PRIVATE'; }, enumerable: true });
    expect(() => validateScheduleDefinitions([{ ...definition, payload: accessor }])).toThrow('Invalid schedule');
    expect(reads).toBe(0); expect(serializations).toBe(0);
    expect(validateScheduleDefinitions([{ ...definition, payload: ['valid', 1, null] }])[0]!.payload).toEqual(['valid', 1, null]);
});
it('lists redacted policy facts and sends identical occurrence identity through local and provider execution', async () => {
    const calls: any[] = []; const dispatcher = { async dispatch(...args: any[]) { calls.push(args); return `dispatch-${calls.length}`; } };
    const runtime = createScheduleRuntime({ schedules: [definition], dispatcher });
    expect(JSON.stringify(runtime.list())).not.toContain('PRIVATE');
    expect(runtime.list()).toEqual([{ name: 'daily-report', cron: definition.cron, job: 'report', timeBasis: 'UTC', overlap: 'distinct-occurrences-allowed', duplicate: 'job-idempotency', retries: 'jobs', missed: 'no-catchup' }]);
    await runtime.runOnce('daily-report', { scheduledTime: 1234 }); await runtime.scheduled({ cron: ' 0 9 * * mon-fri ', scheduledTime: 1234 });
    expect(calls[0]).toEqual(calls[1]); expect(calls[0][2].idempotencyKey).toBe('schedule:daily-report:1234');
    (calls[0][1] as any).title = 'changed'; await runtime.runOnce('daily-report', { scheduledTime: 2234 }); expect(calls[2][1]).toEqual(definition.payload);
});
it('selects all distinct names on one cron and keeps their occurrence keys separate', async () => {
    const keys: string[] = []; const runtime = createScheduleRuntime({ schedules: [definition, { ...definition, name: 'second-report' }], dispatcher: { async dispatch(_name: string, _payload: unknown, config: any) { keys.push(config.idempotencyKey); return config.idempotencyKey; } } });
    expect(await runtime.scheduled({ cron: definition.cron, scheduledTime: 1234 })).toHaveLength(2); expect(new Set(keys).size).toBe(2);
});
it('rejects unknown trigger/name, invalid times, and missing adapters before dispatch', async () => {
    let calls = 0; const runtime = createScheduleRuntime({ schedules: [definition], dispatcher: { async dispatch() { calls++; return 'id'; } } });
    for (const scheduledTime of [-1, NaN, Infinity, 0.5, 8_640_000_000_000_001]) await expect(runtime.runOnce('daily-report', { scheduledTime })).rejects.toThrow('UTC epoch');
    // @ts-expect-error Deliberately unknown name also proves the runtime guard.
    await expect(runtime.runOnce('missing', { scheduledTime: 0 })).rejects.toThrow('Unknown schedule');
    await expect(runtime.scheduled({ cron: '* * * * *', scheduledTime: 0 })).rejects.toThrow('Unknown schedule trigger'); expect(calls).toBe(0);
    expect(() => createScheduleRuntime({ schedules: [], dispatcher: undefined as any })).toThrow('explicit job dispatcher');
});
function actualJobs(handle: (payload: { title: string }, context: any) => void | Promise<void>) {
    const adapter = new LocalJobAdapter(); const store = new MemoryJobStore();
    const jobs = createJobRuntime({ namespace: 'staging', adapter, store, now: adapter.now, jobs: { report: defineJob({ schema: input.object({ title: input.string({ required: true }) }), handle }) } });
    const schedules = createScheduleRuntime({ schedules: [definition], dispatcher: jobs });
    return { adapter, store, jobs, schedules };
}
it('uses actual job schema and cleanup for both one-shot and provider events and deduplicates repeated occurrences', async () => {
    let effects = 0; let cleanup = 0; const f = actualJobs((_payload, context) => { effects++; context.onCleanup(async () => { await Promise.resolve(); cleanup++; }); });
    await f.schedules.runOnce('daily-report', { scheduledTime: 1000 }); await f.schedules.scheduled({ cron: definition.cron, scheduledTime: 1000 });
    expect(await f.adapter.drain(f.jobs)).toEqual([{ status: 'completed' }, { status: 'duplicate' }]); expect(effects).toBe(1); expect(cleanup).toBe(1);
    const invalid = createScheduleRuntime({ schedules: [{ ...definition, payload: { title: '' } }], dispatcher: f.jobs });
    await expect(invalid.runOnce('daily-report', { scheduledTime: 2000 })).rejects.toThrow('payload validation');
    await expect(invalid.scheduled({ cron: definition.cron, scheduledTime: 2000 })).rejects.toThrow('payload validation'); expect(f.adapter.snapshot()).toHaveLength(0); expect(effects).toBe(1);
});
it('allows distinct occurrences to overlap while duplicate active occurrence stays busy', async () => {
    const releases: Array<() => void> = []; const f = actualJobs(async () => { await new Promise<void>(resolve => releases.push(resolve)); });
    await f.schedules.runOnce('daily-report', { scheduledTime: 1000 }); await f.schedules.runOnce('daily-report', { scheduledTime: 2000 });
    const [first, second] = f.adapter.snapshot().map(item => item.envelope);
    const running = [f.jobs.consume(first), f.jobs.consume(second)]; await expect.poll(() => releases.length).toBe(2);
    expect((await f.jobs.consume(first)).status).toBe('retry'); releases.forEach(release => release()); expect(await Promise.all(running)).toEqual([{ status: 'completed' }, { status: 'completed' }]);
});
it('delegates transient retry ownership to jobs instead of creating extra schedule execution', async () => {
    let attempts = 0; let cleanup = 0; const f = actualJobs((_payload, context) => { context.onCleanup(() => { cleanup++; }); if (++attempts === 1) throw new TransientJobError(); });
    await f.schedules.scheduled({ cron: definition.cron, scheduledTime: 1000 }); expect((await f.adapter.drain(f.jobs))[0]!.status).toBe('retry');
    f.adapter.advance(5); expect(await f.adapter.drain(f.jobs)).toEqual([{ status: 'completed' }]); expect(attempts).toBe(2); expect(cleanup).toBe(2);
});
it('accepts a validated JSON registry with an actual typed job dispatcher', async () => {
    let effects = 0; const f = actualJobs(() => { effects++; });
    const json: unknown = JSON.parse(JSON.stringify([definition]));
    const validated = validateScheduleDefinitions(json);
    const schedules = createScheduleRuntime({ schedules: validated, dispatcher: f.jobs });
    await schedules.runOnce('daily-report', { scheduledTime: 1234 });
    expect(await f.adapter.drain(f.jobs)).toEqual([{ status: 'completed' }]); expect(effects).toBe(1);
});
it('retries a partially dispatched occurrence with stable keys for earlier successful sends', async () => {
    let fail = true; const calls: string[] = [];
    const runtime = createScheduleRuntime({ schedules: [definition, { ...definition, name: 'second' }], dispatcher: { async dispatch(_name: string, _payload: unknown, options: any) { calls.push(options.idempotencyKey); if (fail && calls.length === 2) throw Error('publish unavailable'); return 'id'; } } });
    await expect(runtime.scheduled({ cron: definition.cron, scheduledTime: 1000 })).rejects.toThrow('publish unavailable'); fail = false;
    await runtime.scheduled({ cron: definition.cron, scheduledTime: 1000 }); expect(calls[0]).toBe(calls[2]); expect(calls[1]).toBe(calls[3]);
});
function staticJobContract() {
    const dispatcher = { async dispatch(_name: 'report', _payload: unknown) { return 'id'; } };
    void createScheduleRuntime({ schedules: [definition], dispatcher });
    // @ts-expect-error Registered dispatcher job names constrain schedule definitions.
    void createScheduleRuntime({ schedules: [{ ...definition, job: 'missing' }], dispatcher });
    const importedJSON: Array<{ name: string; cron: string; job: string; payload: unknown; scope: {} }> = [];
    // @ts-expect-error Broad JSON job names require the explicit validator boundary.
    void createScheduleRuntime({ schedules: importedJSON, dispatcher });
    void createScheduleRuntime({ schedules: validateScheduleDefinitions(importedJSON), dispatcher });
}
void staticJobContract;
