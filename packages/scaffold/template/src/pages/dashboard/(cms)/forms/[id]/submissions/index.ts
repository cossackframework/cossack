import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Badge, Button, Card, CardBody, Checkbox, Input, NativeSelect } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { displayValue, isCmsError, PERMISSIONS, SUBMISSION_STATUSES, type SubmissionStatus } from '@cossackframework/cms';
import type { LoadedForm } from '@cossackframework/cms/server';
import { requireAny } from '../../../../../../cms/guards';
import { linkButton, notice, pageHeader, shortDate } from '../../../../../../cms/ui';

/** Columns the inbox shows: the form's first inputs, as Gravity Forms' entry list. */
const COLUMNS = 4;
const PAGE_SIZE = 25;

interface Row { id: string; status: SubmissionStatus; cells: string[]; date: string }

type Tab = 'all' | SubmissionStatus;
const BULK: Record<Tab, [string, string][]> = {
    all: [['read', 'Mark as read'], ['new', 'Mark as unread'], ['spam', 'Mark as spam'], ['trash', 'Move to trash']],
    new: [['read', 'Mark as read'], ['spam', 'Mark as spam'], ['trash', 'Move to trash']],
    read: [['new', 'Mark as unread'], ['spam', 'Mark as spam'], ['trash', 'Move to trash']],
    spam: [['read', 'Not spam'], ['delete', 'Delete permanently']],
    trash: [['read', 'Restore'], ['delete', 'Delete permanently']],
};

/**
 * A form's submissions: status tabs with counts, search over the text answers, the newest
 * first a page at a time, bulk actions and a CSV export. Needs `cms:submissions`.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSubmissions)] })
export default class SubmissionsPage extends Cossack {
    @State() form: { id: string; title: string; slug: string } | null = null;
    @State() columns: string[] = [];
    @State() status: Tab = 'all';
    @State() counts: Record<string, number> = {};
    @State() rows: Row[] = [];
    @State() search = '';
    @State() after = '';
    @State() next = '';
    @State() selected: string[] = [];
    @State() bulk = '';
    @State() error = '';

    head(): HeadValue {
        return { title: this.form ? `${__('Submissions')}: ${this.form.title}` : __('Submissions') };
    }

    async init() {
        const status = this.c.req.query('status') ?? '';
        this.status = (SUBMISSION_STATUSES as readonly string[]).includes(status) ? status as SubmissionStatus : 'all';
        this.search = (this.c.req.query('q') ?? '').slice(0, 200);
        this.after = (this.c.req.query('after') ?? '').slice(0, 200);
        await this.load();
        if (!this.form) this.c.status(404);
    }

    private async loaded(): Promise<LoadedForm | null> {
        return this.c.get('cms').forms.get(this.c.req.param('id') ?? '');
    }

    @Server()
    private async load() {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const form = await this.loaded();
        if (!form) { this.form = null; return; }
        this.form = { id: form.ref.id, title: form.ref.title, slug: form.ref.slug };
        const inputs = form.ref.inputs.slice(0, COLUMNS);
        this.columns = inputs.map(input => input.label);
        const counts = await cms.forms.counts(form, principal);
        this.counts = { ...counts, all: counts.new + counts.read };
        try {
            const page = await cms.forms.list(form, { ...(this.status === 'all' ? {} : { status: this.status }), ...(this.search ? { search: this.search } : {}), ...(this.after && !this.search ? { after: this.after } : {}), limit: PAGE_SIZE }, principal);
            this.rows = page.items.map(item => ({ id: item.id, status: item.status, date: shortDate(item.createdAt), cells: inputs.map(input => displayValue(input, item.values[input.name]).slice(0, 120)) }));
            this.next = page.next ?? '';
            this.error = '';
        } catch (error) {
            if (!isCmsError(error)) throw error;
            this.rows = [];
            this.error = error.message;
        }
        this.selected = [];
    }

    @Server()
    async apply(ids: string[], action: string) {
        const cms = this.c.get('cms');
        const form = await this.loaded();
        if (!form) return;
        try {
            if (action === 'delete') await cms.forms.delete(form, ids, this.c.get('principal'));
            else if ((SUBMISSION_STATUSES as readonly string[]).includes(action)) await cms.forms.setStatus(form, ids, action as SubmissionStatus, this.c.get('principal'));
        } catch (error) { if (!isCmsError(error)) throw error; this.error = error.message; return; }
        await this.load();
    }

    @Client()
    async applyBulk() {
        if (!this.bulk || !this.selected.length) return;
        await this.apply(this.selected, this.bulk);
        this.bulk = '';
    }

    @Client()
    toggle(id: string, checked: boolean) {
        this.selected = checked ? [...new Set([...this.selected, id])] : this.selected.filter(entry => entry !== id);
    }

    @Client()
    toggleAll(checked: boolean) {
        this.selected = checked ? this.rows.map(row => row.id) : [];
    }

    private href(changes: Record<string, string>) {
        const next = { status: this.status === 'all' ? '' : this.status, q: this.search, ...changes };
        const params = new URLSearchParams(Object.entries(next).filter(([, value]) => value));
        return `/dashboard/forms/${this.form?.id ?? ''}/submissions${params.size ? `?${params}` : ''}`;
    }

    private row(row: Row): TemplateResult {
        const detail = `/dashboard/forms/${this.form?.id ?? ''}/submissions/${row.id}`;
        const unread = row.status === 'new';
        return html`<tr class=${`border-b border-border last:border-0 align-top ${unread ? 'font-semibold' : ''}`} data-submission=${row.id} data-status=${row.status}>
            <td class="px-4 py-3">${component(Checkbox, { checked: this.selected.includes(row.id), 'aria-label': `${__('Select submission from')} ${row.date}`, '@change': (event: Event) => this.toggle(row.id, (event.target as HTMLInputElement).checked) })}</td>
            ${row.cells.map((cell, index) => html`<td class="max-w-xs px-4 py-3"><span class="block truncate">${index === 0 ? html`<a href=${detail} class="text-foreground hover:text-primary">${cell || __('(empty)')}</a>` : cell}</span></td>`)}
            <td class="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground"><a href=${detail} class="text-muted-foreground hover:text-primary">${row.date}</a></td>
            <td class="px-4 py-3">${unread ? component(Badge, { variant: 'default' }, __('New')) : row.status === 'spam' ? component(Badge, { variant: 'destructive' }, __('Spam'))
                : row.status === 'trash' ? component(Badge, { variant: 'secondary' }, __('Trash')) : null}</td>
        </tr>`;
    }

    render() {
        if (!this.form) return html`<div class="space-y-4">${pageHeader(__('Submissions'))}${notice(__('This form does not exist.'), 'error')}<a href="/dashboard/forms" class="text-sm text-primary hover:underline">${__('All forms')}</a></div>`;
        const tabs: [Tab, string][] = [['all', __('All')], ['new', __('Unread')], ['read', __('Read')], ['spam', __('Spam')], ['trash', __('Trash')]];
        const exportUrl = `/api/cms/forms/${this.form.id}/submissions/export${this.status === 'all' ? '' : `?status=${this.status}`}`;
        return html`<div class="space-y-6">
            ${pageHeader(`${__('Submissions')}: ${this.form.title}`, {
                description: `${__('Form')} ${this.form.slug}`,
                actions: html`${linkButton(__('Export CSV'), exportUrl, 'outline')}${linkButton(__('Edit form'), `/dashboard/content/forms/${this.form.id}`, 'outline')}`,
            })}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <nav aria-label=${__('Filter by status')} class="flex flex-wrap gap-x-3 gap-y-1 text-sm">${tabs.map(([key, label], index) => html`${index ? html`<span class="text-muted-foreground" aria-hidden="true">|</span>` : null}
                    <a href=${this.href({ status: key === 'all' ? '' : key, q: '' })} aria-current=${this.status === key ? 'page' : 'false'}
                        class=${this.status === key ? 'font-semibold text-foreground no-underline' : 'text-primary no-underline hover:underline'}>${label} <span class="text-muted-foreground">(${this.counts[key] ?? 0})</span></a>`)}</nav>
                <form method="get" class="flex gap-2" role="search">
                    ${this.status !== 'all' ? html`<input type="hidden" name="status" value=${this.status}>` : null}
                    ${component(Input, { type: 'search', name: 'q', size: 'sm', value: this.search, placeholder: __('Search submissions'), 'aria-label': __('Search submissions') })}
                    ${component(Button, { type: 'submit', size: 'sm', variant: 'outline' }, __('Search'))}
                </form>
            </div>
            <div class="flex items-center gap-2">
                ${component(NativeSelect, { size: 'sm', 'aria-label': __('Bulk actions'), '@change': (event: Event) => { this.bulk = (event.target as HTMLSelectElement).value; } }, html`
                    <option value="" ?selected=${!this.bulk}>${__('Bulk actions')}</option>
                    ${BULK[this.status].map(([value, label]) => html`<option value=${value}>${__(label)}</option>`)}`)}
                ${component(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: !this.bulk || !this.selected.length, '@click': () => this.applyBulk() }, __('Apply'))}
            </div>
            ${component(Card, {}, component(CardBody, { class: 'p-0' }, html`<div class="overflow-x-auto"><table class="w-full text-sm">
                <thead><tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th class="w-10 px-4 py-3">${component(Checkbox, { checked: this.rows.length > 0 && this.selected.length === this.rows.length, 'aria-label': __('Select all'), '@change': (event: Event) => this.toggleAll((event.target as HTMLInputElement).checked) })}</th>
                    ${this.columns.map(column => html`<th class="px-4 py-3 font-medium">${column}</th>`)}
                    <th class="px-4 py-3 font-medium">${__('Submitted')}</th><th class="px-4 py-3"><span class="sr-only">${__('Status')}</span></th>
                </tr></thead>
                <tbody>${this.rows.map(row => this.row(row))}</tbody></table>
                ${this.rows.length ? null : html`<p class="px-4 py-10 text-center text-sm text-muted-foreground">${this.search ? __('No submissions match.') : __('No submissions yet.')}</p>`}</div>`))}
            ${this.after || this.next ? html`<nav aria-label=${__('Pages')} class="flex justify-between text-sm">
                ${this.after ? html`<a href=${this.href({})} class="text-primary hover:underline">${__('Newest')}</a>` : html`<span></span>`}
                ${this.next ? html`<a href=${this.href({ after: this.next })} class="text-primary hover:underline">${__('Older')}</a>` : null}
            </nav>` : null}
        </div>`;
    }
}
