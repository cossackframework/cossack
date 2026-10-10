import type { ScheduleDefinition, ScheduleEvent, ScheduleInspection, ScheduleOccurrence, ValidatedScheduleDefinitions } from './contracts';
import { invalidSchedule, validateScheduleCron } from './cron';
const NAME = /^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/;

/** Pure JSON validation suitable for compiler/inspection preflight. Never reads accessors. */
export function validateScheduleDefinitions(raw: unknown): ValidatedScheduleDefinitions {
    let nodes = 0; const ancestors = new Set<object>();
    const visit = (value: unknown, depth: number): void => {
        if (++nodes > 32768 || depth > 32) invalidSchedule();
        if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
        if (typeof value !== 'object' || ancestors.has(value)) invalidSchedule();
        const array = Array.isArray(value);
        if (array ? Object.getPrototypeOf(value) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalidSchedule();
        const keys = Reflect.ownKeys(value);
        let length = 0;
        if (array) {
            const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
            if (!descriptor || !('value' in descriptor) || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0 || descriptor.value > 32768) invalidSchedule();
            length = descriptor.value;
            if (keys.length !== length + 1) invalidSchedule();
        }
        ancestors.add(value);
        for (const key of keys) {
            if (array && key === 'length') continue;
            if (array && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)) invalidSchedule();
            const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
            if (typeof key !== 'string' || !('value' in descriptor) || !descriptor.enumerable || ['__proto__', 'prototype', 'constructor'].includes(key)) invalidSchedule();
            visit(descriptor.value, depth + 1);
        }
        ancestors.delete(value);
    };
    visit(raw, 0);
    if (!Array.isArray(raw) || raw.length > 1000) invalidSchedule();
    const serialized = JSON.stringify(raw); if (new TextEncoder().encode(serialized).length > 1024 * 1024) invalidSchedule();
    const copied = JSON.parse(serialized) as ScheduleDefinition[];
    const names = new Set<string>();
    for (const definition of copied) {
        if (!definition || typeof definition !== 'object' || Array.isArray(definition) || Object.keys(definition).some(key => !['name', 'cron', 'job', 'payload', 'scope'].includes(key))) invalidSchedule();
        if (!Object.hasOwn(definition, 'payload') || typeof definition.name !== 'string' || !NAME.test(definition.name) || typeof definition.job !== 'string' || !NAME.test(definition.job) || names.has(definition.name)) invalidSchedule();
        names.add(definition.name);
        (definition as { cron: string }).cron = validateScheduleCron(definition.cron);
        const scope = definition.scope;
        if (!scope || typeof scope !== 'object' || Array.isArray(scope) || Object.keys(scope).some(key => !['tenantId', 'actorId'].includes(key))) invalidSchedule();
        if (Object.values(scope).some(value => typeof value !== 'string' || !value || value.length > 256)) invalidSchedule();
        if (new TextEncoder().encode(JSON.stringify(definition.payload)).length > 120 * 1024) invalidSchedule();
    }
    return copied as unknown as ValidatedScheduleDefinitions;
}
function occurrence(raw: ScheduleOccurrence): number {
    if (!raw || typeof raw.scheduledTime !== 'number' || !Number.isSafeInteger(raw.scheduledTime) || raw.scheduledTime < 0 || raw.scheduledTime > 8_640_000_000_000_000) throw new Error('[Cossack] Invalid schedule occurrence. Supply UTC epoch milliseconds.');
    return raw.scheduledTime;
}
type DispatcherJob<D extends { dispatch: (...args: any[]) => Promise<string> }> =
    [Extract<Parameters<D['dispatch']>[0], string>] extends [never] ? string : Extract<Parameters<D['dispatch']>[0], string>;
export function createScheduleRuntime<
    D extends { dispatch: (...args: any[]) => Promise<string> },
    S extends readonly ScheduleDefinition<DispatcherJob<D>>[],
>(options: { schedules: S | ValidatedScheduleDefinitions; dispatcher: D }) {
    if (!options.dispatcher || typeof options.dispatcher.dispatch !== 'function') throw new Error('[Cossack] Schedules require an explicit job dispatcher.');
    const schedules = validateScheduleDefinitions(options.schedules);
    async function dispatch(definition: ScheduleDefinition, scheduledTime: number): Promise<string> {
        // Each invocation receives detached JSON; dispatcher/handlers cannot mutate registry state.
        return options.dispatcher.dispatch(definition.job, structuredClone(definition.payload), { scope: { ...definition.scope }, idempotencyKey: `schedule:${definition.name}:${scheduledTime}` });
    }
    function list(): readonly ScheduleInspection[] {
        return schedules.map(({ name, cron, job }) => ({ name, cron, job, timeBasis: 'UTC', overlap: 'distinct-occurrences-allowed', duplicate: 'job-idempotency', retries: 'jobs', missed: 'no-catchup' }));
    }
    async function runOnce(name: S[number]['name'], config: ScheduleOccurrence): Promise<string> {
        const time = occurrence(config); const definition = schedules.find(schedule => schedule.name === name);
        if (!definition) throw new Error('[Cossack] Unknown schedule. Inspect registered schedule names.');
        return dispatch(definition, time);
    }
    async function scheduled(event: ScheduleEvent): Promise<readonly string[]> {
        const time = occurrence(event); const cron = validateScheduleCron(event.cron);
        const selected = schedules.filter(schedule => schedule.cron === cron);
        if (!selected.length) throw new Error('[Cossack] Unknown schedule trigger. Check the selected environment cron registry.');
        // A caller/provider retry, if one occurs, uses the same occurrence keys;
        // jobs deduplicate earlier successful sends. This runtime does not reschedule.
        const ids: string[] = [];
        for (const definition of selected) ids.push(await dispatch(definition, time));
        return ids;
    }
    return { list, runOnce, scheduled };
}
