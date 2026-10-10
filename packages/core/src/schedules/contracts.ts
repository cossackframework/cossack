import type { JobScope } from '../jobs/contracts';

export interface ScheduleDefinition<Name extends string = string, Payload = unknown> {
    readonly name: string;
    readonly cron: string;
    readonly job: Name;
    readonly payload: Payload;
    readonly scope: Readonly<JobScope>;
}
export interface ScheduleOccurrence { readonly scheduledTime: number; }
export interface ScheduleEvent extends ScheduleOccurrence { readonly cron: string; }
declare const VALIDATED_SCHEDULES: unique symbol;
/** JSON registries cross the static job-name boundary only after pure validation. */
export type ValidatedScheduleDefinitions = readonly ScheduleDefinition[] & { readonly [VALIDATED_SCHEDULES]: true };
export interface ScheduleInspection {
    readonly name: string;
    readonly cron: string;
    readonly job: string;
    readonly timeBasis: 'UTC';
    readonly overlap: 'distinct-occurrences-allowed';
    readonly duplicate: 'job-idempotency';
    readonly retries: 'jobs';
    readonly missed: 'no-catchup';
}
