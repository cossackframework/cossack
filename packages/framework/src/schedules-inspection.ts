/** Node-only static schedule tooling. Never imports application modules or dispatches work. */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { validateScheduleDefinitions, validateScheduleCron, type ScheduleDefinition } from '@cossackframework/core/schedules';
import { findCloudflareConfig, readCloudflareDeclarationConfig, resolveConfigRuntime } from './config-preflight.js';

export class SchedulePreflightError extends Error {
    constructor(readonly code: string) { super('Schedule declarations are invalid. Inspect src/schedules.json and the selected scheduler configuration.'); }
}
export async function readScheduleDefinitions(root: string) {
    const file = join(root, 'src/schedules.json');
    try {
        if ((await stat(file)).size > 128 * 1024) throw new SchedulePreflightError('COSSACK_SCHEDULES_INVALID');
        const source = await readFile(file, 'utf8');
        if (new TextEncoder().encode(source).length > 128 * 1024) throw new SchedulePreflightError('COSSACK_SCHEDULES_INVALID');
        return validateScheduleDefinitions(JSON.parse(source));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw new SchedulePreflightError('COSSACK_SCHEDULES_INVALID');
    }
}
export async function inspectSchedules(root: string, environment?: string) {
    const diagnostics: { code: string; severity: 'error'; message: string; source: string }[] = [];
    const add = (code: string) => diagnostics.push({ code, severity: 'error', message: 'Check schedule declarations and the selected scheduler configuration.', source: 'src/schedules.json' });
    const runtime = await resolveConfigRuntime(root);
    let definitions: readonly ScheduleDefinition[] = [];
    try { definitions = await readScheduleDefinitions(root); } catch { add('COSSACK_SCHEDULES_INVALID'); }
    if (definitions.length) {
        if (runtime !== 'cloudflare') add('COSSACK_SCHEDULER_ADAPTER_REQUIRED');
        else {
            try {
                const configPath = await findCloudflareConfig(root);
                if (!configPath) throw new SchedulePreflightError('COSSACK_SCHEDULER_ADAPTER_REQUIRED');
                const config = await readCloudflareDeclarationConfig(root, configPath, environment);
                const crons = config.triggers?.crons;
                if (!Array.isArray(crons)) throw new SchedulePreflightError('COSSACK_SCHEDULE_TRIGGERS_MISMATCH');
                const configured = [...new Set(crons.map(validateScheduleCron))].sort();
                const declared = [...new Set(definitions.map(item => item.cron))].sort();
                if (JSON.stringify(configured) !== JSON.stringify(declared)) throw new SchedulePreflightError('COSSACK_SCHEDULE_TRIGGERS_MISMATCH');
            } catch (error) { add(error instanceof SchedulePreflightError ? error.code : 'COSSACK_SCHEDULE_CONFIGURATION_UNKNOWN'); }
        }
    }
    return { scope: 'schedules' as const, runtime, environment: environment ?? null,
        schedules: definitions.map(({ name, cron, job }) => ({ name, cron, job })),
        policy: { timeBasis: 'UTC', overlap: 'distinct-occurrences-may-overlap', duplicate: 'job-ledger-deduplication', retries: 'jobs-own-execution-retries', missedRuns: 'no-framework-catchup' },
        readiness: { declarations: diagnostics.length ? 'invalid' : 'valid', handler: 'not-checked', remote: 'not-checked' }, diagnostics };
}
