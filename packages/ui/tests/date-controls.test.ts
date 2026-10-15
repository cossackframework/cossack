import { expect, it, vi } from 'vitest';
import { component, renderToString } from '@cossackframework/renderer';
import { Calendar } from '../src/components/Calendar';
import { DatePicker } from '../src/components/DatePicker';
import { parseDate, isoDate, shiftDays, shiftMonths, dateRange, isCalendarDate } from '../src/internal/date';

it.each(['0001-01-01','0099-12-31','1900-02-28','2000-02-29','2024-02-29','9999-12-31'])('round-trips a real date %s without local timezone arithmetic',iso=>expect(isoDate(parseDate(iso)!)).toBe(iso));
it.each(['0000-01-01','10000-01-01','1900-02-29','2023-02-29','2024-02-30','2024-13-01','2024-01-00','2024-1-01','2024-01-01T00:00:00Z'])('rejects invalid date %s',iso=>expect(()=>parseDate(iso)).toThrow('real Gregorian date'));
it('clamps month/year arithmetic and handles bounded day movement',()=>{
    expect(shiftMonths('2024-01-31',1)).toBe('2024-02-29');
    expect(shiftMonths('2024-02-29',12)).toBe('2025-02-28');
    expect(shiftMonths('0001-01-31',-1)).toBe('0001-01-31');
    expect(shiftMonths('9999-12-31',1)).toBe('9999-12-31');
    expect(shiftDays('2024-02-28',1)).toBe('2024-02-29');
    expect(shiftDays('2024-02-29',1)).toBe('2024-03-01');
    expect(shiftDays('0001-01-01',-1)).toBe('0001-01-01');
    expect(shiftDays('9999-12-31',1)).toBe('9999-12-31');
    expect(()=>dateRange('2024-03-01','2024-02-29')).toThrow('min must be');
});
it('renders the selected month on the server with one focusable day and correct Gregorian year',()=>{
    const onValueChange=vi.fn();
    const output=renderToString(component(Calendar,{id:'calendar',value:'0099-02-05',today:'2024-02-29',min:'0099-02-02',max:'0099-02-20',onValueChange}));
    expect(output).toContain('February 99');
    expect(output).toContain('role="grid"');
    expect(output).toContain('aria-labelledby="calendar-month"');
    expect(output.match(/tabindex="0"/g)).toHaveLength(1);
    expect(output).toMatch(/data-date="0099-02-05" tabindex="0"/);
    expect(output).toMatch(/data-date="0099-02-01"[^>]*disabled/);
    expect(output).toContain('aria-selected="true"');
    expect(onValueChange).not.toHaveBeenCalled();
});
it('follows parent date changes before mount and supports localized weeks',()=>{
    const calendar=new Calendar();calendar.props={id:'calendar',value:'2024-02-29',today:'2024-02-01'};
    expect(renderToString(calendar.render())).toContain('February 2024');
    calendar.props={id:'calendar',value:'2025-03-10',locale:'de-DE',weekStartsOn:1,today:'2024-02-01'};
    const output=renderToString(calendar.render());expect(output).toContain('März 2025');expect(output).toContain('abbr="Montag"');
});
it('renders native date values, form attributes and a stable calendar trigger',()=>{
    const output=renderToString(component(DatePicker,{id:'date',name:'due',value:'2024-02-29',min:'2024-02-01',max:'2024-03-31',required:true,'aria-label':'Due date'}));
    expect(output).toContain('type="date" name="due"');expect(output).toContain('value="2024-02-29"');
    expect(output).toContain('min="2024-02-01"');expect(output).toContain('max="2024-03-31"');
    expect(output).toContain('aria-controls="date-popup"');expect(output).toContain('aria-haspopup="dialog"');
    expect(output).not.toMatch(/onValueChange=|defaultValue=/);
});
it.each([Calendar,DatePicker])('rejects invalid component dates and ranges',Control=>{
    const control=new Control();
    control.props={id:'date',value:'2024-02-30'};expect(()=>control.render()).toThrow('real Gregorian date');
    control.props={id:'date',min:'2024-03-01',max:'2024-02-01'};expect(()=>control.render()).toThrow('min must be');
    control.props={id:'date',weekStartsOn:7};expect(()=>control.render()).toThrow('weekStartsOn');
});

it('guards external data without accepting empty, rolled-over or timestamp values',()=>{
    expect(isCalendarDate('2024-02-29')).toBe(true);
    for(const value of ['',null,undefined,42,'2024-02-30','2024-02-29T00:00:00Z']) expect(isCalendarDate(value)).toBe(false);
});

it('keeps date-only labels and arithmetic stable across host timezones',()=>{
    try {
        for(const timezone of ['UTC','America/Los_Angeles','Pacific/Kiritimati']) {
            vi.stubEnv('TZ',timezone);
            expect(isoDate(parseDate('2024-03-10')!)).toBe('2024-03-10');
            expect(shiftDays('2024-03-10',1)).toBe('2024-03-11');
            expect(renderToString(component(DatePicker,{id:'due',value:'2024-03-10'}))).toContain('Sunday, March 10, 2024');
        }
    } finally { vi.unstubAllEnvs(); }
});
