import { Cossack, Page, State, type HeadValue } from '@cossackframework/core';
import { Badge } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS, recordTitle } from '@cossackframework/cms';
import { requireAny } from '../../../../cms/guards';
import { pageHeader } from '../../../../cms/ui';

interface Day { date: string; day: number; inMonth: boolean; entries: { id: string; title: string; href: string; status: string; collection: string; time: string }[] }

/**
 * Content → Calendar: the month's published and scheduled entries of every collection, by their
 * publication day, each linking to its editor. Days follow UTC, as the entries' times do.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.dashboard)] })
export default class CalendarPage extends Cossack {
    @State() month = '';
    @State() weeks: Day[][] = [];
    @State() weekdays: string[] = [];
    @State() count = 0;

    head(): HeadValue {
        return { title: 'Calendar' };
    }

    async init() {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const requested = /^\d{4}-(0[1-9]|1[0-2])$/.test(this.c.req.query('month') ?? '') ? this.c.req.query('month')! : new Date().toISOString().slice(0, 7);
        this.month = requested;
        const [year, month] = requested.split('-').map(Number) as [number, number];
        const start = Date.UTC(year, month - 1, 1);
        const end = Date.UTC(year, month, 1);
        const settings = await cms.settings.all();
        const weekStart = settings['general.weekStartsOn'] === 'sunday' ? 0 : settings['general.weekStartsOn'] === 'saturday' ? 6 : 1;
        const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        this.weekdays = Array.from({ length: 7 }, (_, index) => __(names[(weekStart + index) % 7]!));
        const byDay = new Map<string, Day['entries']>();
        for (const collection of cms.collections()) {
            if (collection.publishable === false || collection.managed) continue;
            try {
                const page = await cms.resource(`cms/${collection.name}`).list({ where: { publishedAt: { gte: start, lt: end }, status: { in: ['published', 'scheduled'] } }, order: { field: 'publishedAt', direction: 'asc' }, limit: 100 }, { principal });
                for (const record of page.records) {
                    const at = new Date(Number(record.publishedAt));
                    const key = at.toISOString().slice(0, 10);
                    const list = byDay.get(key) ?? [];
                    list.push({ id: record.id, title: recordTitle(record, 'title'), href: `/dashboard/content/${collection.name}/${record.id}`, status: String(record.status), collection: collection.label, time: at.toISOString().slice(11, 16) });
                    byDay.set(key, list);
                    this.count++;
                }
            } catch (error) { if (!isCmsError(error)) throw error; }
        }
        // The grid starts on the week's first day before the 1st and ends after the last day.
        const first = new Date(start);
        const lead = (first.getUTCDay() - weekStart + 7) % 7;
        const days: Day[] = [];
        for (let offset = -lead; ; offset++) {
            const date = new Date(Date.UTC(year, month - 1, 1 + offset));
            if (date.getTime() >= end && days.length % 7 === 0) break;
            const key = date.toISOString().slice(0, 10);
            days.push({ date: key, day: date.getUTCDate(), inMonth: date.getTime() >= start && date.getTime() < end, entries: byDay.get(key) ?? [] });
        }
        this.weeks = Array.from({ length: days.length / 7 }, (_, index) => days.slice(index * 7, index * 7 + 7));
    }

    private shift(delta: number): string {
        const [year, month] = this.month.split('-').map(Number) as [number, number];
        const date = new Date(Date.UTC(year, month - 1 + delta, 1));
        return `/dashboard/calendar?month=${date.toISOString().slice(0, 7)}`;
    }

    render() {
        const [year, month] = this.month.split('-').map(Number) as [number, number];
        const title = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        return html`<div class="space-y-6">
            ${pageHeader(__('Calendar'), { description: __('Published and scheduled entries by day. Times are UTC.') })}
            <nav class="flex items-center justify-between" aria-label=${__('Month')}>
                <a href=${this.shift(-1)} class="text-sm text-primary hover:underline">← ${__('Previous month')}</a>
                <h2 class="text-lg font-semibold text-foreground" data-testid="calendar-month">${title} <span class="text-sm font-normal text-muted-foreground">· ${this.count} ${__('entries')}</span></h2>
                <a href=${this.shift(1)} class="text-sm text-primary hover:underline">${__('Next month')} →</a>
            </nav>
            <div class="overflow-x-auto rounded-xl border border-border bg-card">
                <table class="w-full table-fixed text-sm" data-testid="calendar">
                    <thead><tr>${this.weekdays.map(name => html`<th class="border-b border-border px-2 py-2 text-left text-xs font-medium uppercase text-muted-foreground">${name}</th>`)}</tr></thead>
                    <tbody>${this.weeks.map(week => html`<tr class="align-top">${week.map(day => html`<td class=${`h-28 border-b border-r border-border p-1.5 last:border-r-0 ${day.inMonth ? '' : 'bg-muted/40 text-muted-foreground'}`} data-date=${day.date}>
                        <div class="text-xs font-medium">${day.day}</div>
                        <ul class="mt-1 space-y-1">${day.entries.map(entry => html`<li class="truncate text-xs"><a href=${entry.href} title=${`${entry.collection}: ${entry.title} (${entry.time})`} class="text-foreground hover:underline">${entry.status === 'scheduled' ? component(Badge, { variant: 'secondary' }, __('Scheduled')) : null} ${entry.title}</a></li>`)}</ul>
                    </td>`)}</tr>`)}</tbody>
                </table>
            </div>
        </div>`;
    }
}
