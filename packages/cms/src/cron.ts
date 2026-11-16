/**
 * Five-field UTC cron expressions as Cloudflare's cron triggers read them: minute, hour, day of
 * month, month and day of week (1 = Sunday to 7 = Saturday; `JAN`, `MON` names allowed), each a
 * `*`, a number, a range, a list or a step. When both the day of month and the day of week are
 * restricted, a day matches either. `nextCronTime` finds the next matching minute after a
 * moment; plugin schedules run from it. Pure functions; no I/O.
 */
import { validateScheduleCron } from '@cossackframework/core/schedules';

export interface CronFields {
    readonly minutes: readonly number[];
    readonly hours: readonly number[];
    /** Days of the month, 1 to 31; empty when unrestricted. */
    readonly days: readonly number[];
    readonly months: readonly number[];
    /** Days of the week, 1 (Sunday) to 7 (Saturday); empty when unrestricted. */
    readonly weekdays: readonly number[];
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const LIMITS: readonly (readonly [number, number])[] = [[0, 59], [0, 23], [1, 31], [1, 12], [1, 7]];
/** How far ahead an occurrence is looked for: a yearly schedule on February 29 needs four years. */
const HORIZON_DAYS = 366 * 5;

/** The expression's fields as sorted numbers; throws on a malformed expression. */
export function parseCron(expression: string): CronFields {
    const fields = validateScheduleCron(expression).split(' ');
    const sets = fields.map((field, index) => {
        const [min, max] = LIMITS[index]!;
        const names = index === 3 ? MONTHS : index === 4 ? WEEKDAYS : [];
        const number = (part: string): number => { const alias = names.indexOf(part); return alias >= 0 ? alias + 1 : Number(part); };
        const values = new Set<number>();
        for (const item of field.split(',')) {
            const [base, stepText] = item.split('/');
            const step = stepText ? Number(stepText) : 1;
            let start = min;
            let end = max;
            if (base !== '*') {
                const range = base!.split('-');
                start = number(range[0]!);
                end = range.length === 2 ? number(range[1]!) : stepText ? max : start;
            }
            for (let value = start; value <= end; value += step) values.add(value);
        }
        const all = values.size === max - min + 1;
        // An unrestricted day field is "any", which matters when the other day field restricts.
        return { values: [...values].sort((a, b) => a - b), all };
    });
    return Object.freeze({
        minutes: sets[0]!.values, hours: sets[1]!.values,
        days: sets[2]!.all ? [] : sets[2]!.values, months: sets[3]!.values,
        weekdays: sets[4]!.all ? [] : sets[4]!.values,
    });
}

/** Whether the UTC day of this moment is one the expression names. */
function dayMatches(fields: CronFields, date: Date): boolean {
    if (!fields.months.includes(date.getUTCMonth() + 1)) return false;
    const day = fields.days.length === 0 || fields.days.includes(date.getUTCDate());
    const weekday = fields.weekdays.length === 0 || fields.weekdays.includes(date.getUTCDay() + 1);
    if (fields.days.length && fields.weekdays.length) return day || weekday;
    return day && weekday;
}

/**
 * The first minute after `after` (exclusive) the expression names, in milliseconds since the
 * epoch. Walks days, then the named hours and minutes within a matching day. Throws when
 * nothing matches within five years (an impossible date such as `0 0 30 2 *`).
 */
export function nextCronTime(expression: string | CronFields, after: number): number {
    const fields = typeof expression === 'string' ? parseCron(expression) : expression;
    const start = Math.floor(after / 60_000) * 60_000 + 60_000;
    const first = new Date(start);
    for (let offset = 0; offset < HORIZON_DAYS; offset++) {
        const day = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate() + offset));
        if (!dayMatches(fields, day)) continue;
        const sameDay = offset === 0;
        for (const hour of fields.hours) {
            if (sameDay && hour < first.getUTCHours()) continue;
            for (const minute of fields.minutes) {
                if (sameDay && hour === first.getUTCHours() && minute < first.getUTCMinutes()) continue;
                return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute);
            }
        }
    }
    throw new Error(`The schedule ${typeof expression === 'string' ? expression : ''} never comes.`.replace('  ', ' '));
}

/** The expression's problem as a sentence, or null when it is valid and has an occurrence. */
export function cronProblem(expression: unknown): string | null {
    if (typeof expression !== 'string') return 'must be a five-field cron expression.';
    try { nextCronTime(expression, Date.now()); return null; }
    catch (error) { return /never comes/.test((error as Error).message) ? 'names a day that never comes.' : 'is not a five-field UTC cron expression (minute hour day month weekday).'; }
}
