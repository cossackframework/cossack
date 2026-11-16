import { describe, expect, it } from 'vitest';
import { cronProblem, nextCronTime, parseCron } from '../src/cron';

const at = (iso: string) => Date.parse(iso);
const next = (cron: string, after: string) => new Date(nextCronTime(cron, at(after))).toISOString();

describe('cron expressions', () => {
    it('parses stars, lists, ranges, steps and names', () => {
        expect(parseCron('*/15 8-10 * * *')).toMatchObject({ minutes: [0, 15, 30, 45], hours: [8, 9, 10], days: [], weekdays: [] });
        expect(parseCron('0 9 1,15 JAN,JUL MON-FRI')).toMatchObject({ days: [1, 15], months: [1, 7], weekdays: [2, 3, 4, 5, 6] });
        expect(parseCron('5/20 * * * *').minutes).toEqual([5, 25, 45]);
        expect(() => parseCron('* * * *')).toThrow();
        expect(() => parseCron('60 * * * *')).toThrow();
    });

    it('finds the next minute after a moment, exclusive', () => {
        expect(next('0 8 * * *', '2026-11-07T07:30:00Z')).toBe('2026-11-07T08:00:00.000Z');
        expect(next('0 8 * * *', '2026-11-07T08:00:00Z')).toBe('2026-11-08T08:00:00.000Z');
        expect(next('0 8 * * *', '2026-11-07T08:00:30Z')).toBe('2026-11-08T08:00:00.000Z');
        expect(next('*/15 * * * *', '2026-11-07T10:07:00Z')).toBe('2026-11-07T10:15:00.000Z');
        expect(next('* * * * *', '2026-11-07T10:07:10Z')).toBe('2026-11-07T10:08:00.000Z');
    });

    it('walks days, months and years', () => {
        expect(next('0 0 1 1 *', '2026-03-01T00:00:00Z')).toBe('2027-01-01T00:00:00.000Z');
        // 2026-11-07 is a Saturday; 2 is Monday.
        expect(next('0 9 * * 2', '2026-11-07T12:00:00Z')).toBe('2026-11-09T09:00:00.000Z');
        expect(next('0 9 * * MON', '2026-11-07T12:00:00Z')).toBe('2026-11-09T09:00:00.000Z');
        // November has 30 days.
        expect(next('0 12 31 * *', '2026-11-07T00:00:00Z')).toBe('2026-12-31T12:00:00.000Z');
        expect(next('30 6 29 2 *', '2026-01-01T00:00:00Z')).toBe('2028-02-29T06:30:00.000Z');
    });

    it('matches either day field when both restrict', () => {
        // The 1st (a Tuesday in December 2026) or any Friday: the first Friday after the 1st comes before the next 1st.
        expect(next('0 0 1 * 6', '2026-12-01T00:00:00Z')).toBe('2026-12-04T00:00:00.000Z');
        expect(next('0 0 1 * 6', '2026-12-26T00:00:00Z')).toBe('2027-01-01T00:00:00.000Z');
    });

    it('describes problems', () => {
        expect(cronProblem('0 8 * * *')).toBeNull();
        expect(cronProblem('0 0 30 2 *')).toBe('names a day that never comes.');
        expect(cronProblem('every day')).toMatch(/five-field/);
        expect(cronProblem(5)).toMatch(/five-field/);
    });
});
