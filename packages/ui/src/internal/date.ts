/** Gregorian date-only arithmetic. UTC avoids host timezone and DST differences. */
export const FIRST_DATE = '0001-01-01';
export const LAST_DATE = '9999-12-31';
export function dateFromParts(year: number, month: number, day: number): Date {
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    return date;
}
export function isoDate(date: Date): string {
    return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
export function parseDate(value: string | undefined, field = 'date'): Date | undefined {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < FIRST_DATE || value > LAST_DATE) {
        throw new RangeError(`${field} must be a real Gregorian date in yyyy-mm-dd format (0001–9999), or empty.`);
    }
    const [year, month, day] = value.split('-').map(Number);
    const date = dateFromParts(year, month, day);
    if (isoDate(date) !== value) throw new RangeError(`${field} must be a real Gregorian date in yyyy-mm-dd format (0001–9999), or empty.`);
    return date;
}
export function dateRange(min?: string, max?: string) {
    parseDate(min, 'min'); parseDate(max, 'max');
    const first = min || FIRST_DATE, last = max || LAST_DATE;
    if (first > last) throw new RangeError('min must be on or before max.');
    return { first, last };
}
export function clampDate(value: string, first = FIRST_DATE, last = LAST_DATE) { return value < first ? first : value > last ? last : value; }
export function monthDays(year: number, month: number) { return dateFromParts(year, month + 1, 0).getUTCDate(); }
export function shiftDays(value: string, days: number): string {
    const date = parseDate(value)!;
    date.setUTCDate(date.getUTCDate() + days);
    if (date.getUTCFullYear() < 1) return FIRST_DATE;
    if (date.getUTCFullYear() > 9999) return LAST_DATE;
    return isoDate(date);
}
export function shiftMonths(value: string, months: number): string {
    const date = parseDate(value)!;
    const index = Math.max(0, Math.min(9999 * 12 - 1, (date.getUTCFullYear() - 1) * 12 + date.getUTCMonth() + months));
    const year = Math.floor(index / 12) + 1, month = index % 12 + 1;
    return isoDate(dateFromParts(year, month, Math.min(date.getUTCDate(), monthDays(year, month))));
}
export function dateLabel(value: string, locale = 'en-US', options: Intl.DateTimeFormatOptions = { dateStyle: 'full' }) {
    return new Intl.DateTimeFormat(locale, { ...options, calendar: 'gregory', timeZone: 'UTC' }).format(parseDate(value)!);
}

/** Test external data before passing it to Calendar or DatePicker. Empty is not a date. */
export function isCalendarDate(value: unknown): value is string {
    if (typeof value !== 'string' || !value) return false;
    try { return !!parseDate(value); } catch { return false; }
}
