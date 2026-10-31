import { getLocale } from '@cossackframework/core';

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60]];

/**
 * A time relative to `now` in the active locale, such as "3 hours ago" or "yesterday".
 * A page takes `now` once into its state, so its server render and the browser's agree.
 */
export function timeAgo(iso: string, now: number): string {
    const time = Date.parse(iso);
    if (Number.isNaN(time)) return iso;
    const seconds = (time - now) / 1000;
    const format = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
    for (const [unit, size] of UNITS) if (Math.abs(seconds) >= size) return format.format(Math.trunc(seconds / size), unit);
    return format.format(0, 'second');
}
