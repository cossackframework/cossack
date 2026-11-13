/**
 * Plugin schedules: the clock's jobs. Each schedule an active plugin declares has a row with
 * its next time. A tick (from maintenance, at most once a minute per site) queues a due
 * occurrence as a `plugin.job` outbox row and advances the row with a conditional update in the
 * same write, so a failed write loses no occurrence, two hosts ticking together never queue one
 * occurrence twice, and occurrences missed while nothing ran collapse into one, or into none past
 * the grace. See `specs/cms-plugin-capabilities.md`.
 */
import type { RomeDB } from '@cossackframework/romedb';
import { nextCronTime } from '../cron';
import type { PluginJobEvent } from '../hooks';
import type { Outbox } from './outbox';

/** A schedule of an active plugin that holds the jobs grant. */
export interface DueSchedule { readonly plugin: string; readonly name: string; readonly cron: string }

export interface ScheduleRow {
    readonly id: string;
    readonly plugin: string;
    readonly name: string;
    readonly cron: string;
    readonly nextAt: number;
    readonly lastAt: number | null;
}

/** An occurrence due longer ago than this is skipped, as a missed cron trigger is. */
export const SCHEDULE_GRACE_MS = 60 * 60_000;
const WRITE = { kind: 'cms.schedules', retryConflicts: 5 } as const;

export class CmsSchedules {
    readonly #db: RomeDB;
    readonly #outbox: Outbox;
    readonly #now: () => number;
    readonly #schedules: () => Promise<readonly DueSchedule[]>;
    readonly #queued: () => void;

    constructor(db: RomeDB, options: { outbox: Outbox; schedules: () => Promise<readonly DueSchedule[]>; now?: () => number; queued?: () => void }) {
        this.#db = db;
        this.#outbox = options.outbox;
        this.#schedules = options.schedules;
        this.#now = options.now ?? Date.now;
        this.#queued = options.queued ?? (() => undefined);
    }

    /** Every schedule row, active plugins' and others'. */
    async list(): Promise<ScheduleRow[]> {
        const result = await this.#db.read([{ rql: 'SELECT id, plugin, name, cron, next_at, last_at FROM cms_schedules ORDER BY plugin, name LIMIT 1000' }]);
        return result.results[0]!.rows.map(row => ({ id: row[0] as string, plugin: row[1] as string, name: row[2] as string, cron: row[3] as string, nextAt: Number(row[4] as bigint), lastAt: row[5] === null ? null : Number(row[5] as bigint) }));
    }

    /** Queue the due occurrences of active plugins' schedules; plan the rest. */
    async tick(): Promise<{ queued: string[]; skipped: string[] }> {
        const now = this.#now();
        const queued: string[] = [];
        const skipped: string[] = [];
        const declared = await this.#schedules();
        if (!declared.length) return { queued, skipped };
        const rows = new Map((await this.list()).map(row => [row.id, row]));
        for (const schedule of declared) {
            const id = `${schedule.plugin}:${schedule.name}`;
            const row = rows.get(id);
            if (!row) {
                await this.#db.write([{
                    rql: 'INSERT INTO cms_schedules (id, plugin, name, cron, next_at, last_at, updated_at) VALUES ($id, $plugin, $name, $cron, $next, NULL, $now) ON CONFLICT (id) DO NOTHING',
                    params: { $id: id, $plugin: schedule.plugin, $name: schedule.name, $cron: schedule.cron, $next: nextCronTime(schedule.cron, now), $now: now },
                }], WRITE);
                continue;
            }
            if (row.cron !== schedule.cron) {
                // An upgrade changed the expression: plan from now.
                await this.#db.write([{
                    rql: 'UPDATE cms_schedules SET cron = $cron, next_at = $next, updated_at = $now WHERE id = $id AND next_at = $expected',
                    params: { $id: id, $cron: schedule.cron, $next: nextCronTime(schedule.cron, now), $now: now, $expected: row.nextAt },
                }], WRITE);
                continue;
            }
            if (row.nextAt > now) continue;
            // One host claims the occurrence; the others see a changed next_at and move on. The
            // claim and the occurrence's outbox row are one write, so a failed write leaves the
            // occurrence due for the next tick instead of advanced and lost.
            const params = { $id: id, $next: nextCronTime(schedule.cron, now), $due: row.nextAt, $now: now };
            const claim = { rql: 'UPDATE cms_schedules SET next_at = $next, last_at = $due, updated_at = $now WHERE id = $id AND next_at = $due', params };
            if (now - row.nextAt > SCHEDULE_GRACE_MS) {
                const claimed = await this.#db.write([claim], WRITE);
                if (claimed.results[0]!.affected === 1n) skipped.push(id);
                continue;
            }
            const event: PluginJobEvent = {
                eventId: `schedule:${id}:${row.nextAt}`, topic: 'plugin.job', at: now, plugin: schedule.plugin, name: schedule.name,
                payload: { cron: schedule.cron, scheduledAt: row.nextAt }, scheduledAt: row.nextAt, key: null,
            };
            const written = await this.#outbox.enqueueWith('plugin.job', event, { rql: 'EXISTS (SELECT 1 FROM cms_schedules WHERE id = $id AND next_at = $due)', params: { $id: id, $due: row.nextAt } }, [claim]);
            if (written.results[0]!.affected === 1n && written.inserted) {
                queued.push(id);
                this.#queued();
            }
        }
        return { queued, skipped };
    }

    /** Drop a plugin's rows, when it is removed from the application. */
    async forget(plugin: string): Promise<void> {
        await this.#db.write([{ rql: 'DELETE FROM cms_schedules WHERE plugin = $plugin', params: { $plugin: plugin } }], WRITE);
    }
}
