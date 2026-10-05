const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export function invalidSchedule(): never { throw new Error('[Cossack] Invalid schedule definition. Check names, five-field UTC cron syntax, JSON payload, and explicit scope.'); }
/** Conservative provider-compatible syntax validation, not a local clock evaluator. */
export function validateScheduleCron(raw: unknown): string {
    if (typeof raw !== 'string' || raw.length > 256) invalidSchedule();
    const expression = raw.trim().toUpperCase().replace(/\s+/g, ' ');
    const fields = expression.split(' '); if (fields.length !== 5) invalidSchedule();
    const limits = [[0, 59], [0, 23], [1, 31], [1, 12], [1, 7]] as const;
    fields.forEach((field, index) => {
        const [min, max] = limits[index]!;
        const names = index === 3 ? MONTHS : index === 4 ? WEEKDAYS : [];
        const number = (part: string): number => {
            const alias = names.indexOf(part);
            if (alias >= 0) return alias + 1;
            if (!/^\d{1,2}$/.test(part)) invalidSchedule();
            const result = Number(part); if (result < min || result > max) invalidSchedule(); return result;
        };
        for (const item of field.split(',')) {
            const segments = item.split('/'); if (segments.length > 2 || !segments[0]) invalidSchedule();
            if (segments.length === 2 && (!/^\d{1,2}$/.test(segments[1]!) || Number(segments[1]) < 1 || Number(segments[1]) > max - min + 1)) invalidSchedule();
            const base = segments[0]!;
            if (base === '*') continue;
            const range = base.split('-'); if (range.length > 2 || range.some(part => !part)) invalidSchedule();
            const start = number(range[0]!); const end = range.length === 2 ? number(range[1]!) : max;
            if (start > end) invalidSchedule();
        }
    });
    return expression;
}
