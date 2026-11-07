import { describe, expect, it } from 'vitest';
import { SITE_ICON_NAMES } from '@cossackframework/cms';
import { iconRegistry } from '@cossackframework/solar-icons/registry';
import { SITE_ICONS } from '../src/cms/site-icons';
import { formatStat, parseStat } from '../src/cms/stat.client';

describe('the site icons', () => {
    it('ship exactly the names the CMS package validates, with the artwork the icon package has now', () => {
        expect(Object.keys(SITE_ICONS).sort()).toEqual([...SITE_ICON_NAMES].sort());
        for (const name of SITE_ICON_NAMES) {
            expect(SITE_ICONS[name]?.line, name).toMatch(/stroke="currentColor"/);
            // The module is written by scripts/site-icons.mjs; a stale one fails here.
            expect(SITE_ICONS[name]?.line, `${name}: run pnpm --dir packages/cms/app run icons`).toBe(iconRegistry[name]?.line);
        }
    });
});

describe('a stat counts up in the digits it was written with', () => {
    it('reads grouped, decimal and plain numbers', () => {
        expect(parseStat('1,250')).toEqual({ target: 1250, group: ',', decimal: '', decimals: 0 });
        expect(parseStat('4.9')).toEqual({ target: 4.9, group: '', decimal: '.', decimals: 1 });
        expect(parseStat('12 000')).toEqual({ target: 12000, group: ' ', decimal: '', decimals: 0 });
        expect(parseStat('1.250,50')).toEqual({ target: 1250.5, group: '.', decimal: ',', decimals: 2 });
        expect(parseStat('98')).toEqual({ target: 98, group: '', decimal: '', decimals: 0 });
        expect(parseStat('24/7')).toBeNull();
    });
    it('writes a number the same way', () => {
        expect(formatStat(312, parseStat('1,250')!)).toBe('312');
        expect(formatStat(1250, parseStat('1,250')!)).toBe('1,250');
        expect(formatStat(2.45, parseStat('4.9')!)).toBe('2.5');
        expect(formatStat(0, parseStat('4.9')!)).toBe('0.0');
        expect(formatStat(625.25, parseStat('1.250,50')!)).toBe('625,25');
        expect(formatStat(12000, parseStat('12 000')!)).toBe('12 000');
    });
});
