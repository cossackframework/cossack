/**
 * The parts of a list screen: one table, one filter bar, one footer, row actions, selection
 * with bulk actions, and tabs kept in the address. Every list built from these reads the same.
 *
 * Filters are a GET form, so the address holds them. The functions return templates; the page
 * owns the rows, the selection and what the actions do. Text has English defaults: pass
 * `labels` to translate it.
 */
import { component, html, ifDefined, type TemplateResult } from '@cossackframework/renderer';
import type { IconEntry } from '@cossackframework/solar-icons/types';
import { MagnifierIcon } from '@cossackframework/solar-icons/magnifier/line';
import { Badge } from '../../components/Badge.js';
import { Button } from '../../components/Button.js';
import { Card, CardBody } from '../../components/Card.js';
import { Checkbox } from '../../components/Checkbox.js';
import { Input } from '../../components/Input.js';
import { NativeSelect } from '../../components/NativeSelect.js';
import { Pagination } from '../../components/Pagination.js';
import { Icon } from '../../icons/Icon.js';

// --- Selection -------------------------------------------------------------------------------

/** The selection after a row's checkbox changes. */
export function toggleSelected(selected: readonly string[], id: string, checked: boolean): string[] {
    return checked ? [...new Set([...selected, id])] : selected.filter(entry => entry !== id);
}

/** The "select all" checkbox of a table's header, over the rows that can be selected. */
export function selectAllBox(ids: readonly string[], selected: readonly string[], change: (ids: string[]) => void, label = 'Select all'): TemplateResult {
    const all = ids.length > 0 && ids.every(id => selected.includes(id));
    return component(Checkbox, { checked: all, indeterminate: !all && ids.some(id => selected.includes(id)), disabled: ids.length === 0, 'aria-label': label,
        '@change': (event: Event) => change((event.target as HTMLInputElement).checked ? [...ids] : []) });
}

/** A row's checkbox. `label` names it for assistive technology, such as "Select Ada". */
export function selectBox(id: string, label: string, selected: readonly string[], change: (ids: string[]) => void): TemplateResult {
    return component(Checkbox, { checked: selected.includes(id), 'aria-label': label,
        '@change': (event: Event) => change(toggleSelected(selected, id, (event.target as HTMLInputElement).checked)) });
}

/** A bulk action of a list; `confirm` is the question to ask first. */
export interface BulkChoice {
    key: string;
    label: string;
    confirm?: string;
}

export interface BulkBarLabels {
    /** The select's name and its empty choice. Defaults to "Bulk actions". */
    bulkActions?: string;
    /** Defaults to "Apply". */
    apply?: string;
    /** After the count of selected rows. Defaults to "selected". */
    selected?: string;
}

export interface BulkBarOptions {
    /** Distinct per bar, such as `bulk-top` and `bulk-bottom`. */
    id: string;
    choices: readonly BulkChoice[];
    /** The chosen action's key; empty for none. */
    value: string;
    count: number;
    choose(key: string): void;
    apply(): void;
    labels?: BulkBarLabels;
}

/** The Bulk actions select, its Apply button and how many rows are selected. */
export function bulkBar(options: BulkBarOptions): TemplateResult {
    const { bulkActions = 'Bulk actions', apply = 'Apply', selected = 'selected' } = options.labels ?? {};
    return html`<div class="flex flex-wrap items-center gap-2" data-bulk-bar>
        <div class="w-44">${component(NativeSelect, { id: options.id, size: 'sm', 'aria-label': bulkActions, '@change': (event: Event) => options.choose((event.target as HTMLSelectElement).value) }, html`
            <option value="" ?selected=${!options.value}>${bulkActions}</option>
            ${options.choices.map(choice => html`<option value=${choice.key} ?selected=${options.value === choice.key}>${choice.label}</option>`)}`)}</div>
        ${component(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: !options.value || !options.count, '@click': () => options.apply() }, apply)}
        ${options.count ? html`<span class="text-xs text-muted-foreground">${options.count} ${selected}</span>` : null}
    </div>`;
}

// --- The table ---------------------------------------------------------------------------------

export interface ListColumn<T> {
    /** The header; empty for a column of controls. */
    label: string | TemplateResult;
    cell(row: T): unknown;
    /** Classes for the header and the cells, such as `w-14` or `text-muted-foreground`. */
    class?: string;
    /** How the list is sorted by this column, for `aria-sort`; a sortable header passes a link as its label. */
    sort?: 'ascending' | 'descending' | 'none';
}

export interface ListSelection<T> {
    selected: readonly string[];
    /** The rows that have a checkbox; all by default. */
    selectable?: readonly string[];
    /** Names a row's checkbox, such as `Select ${row.name}`. */
    label(row: T): string;
    change(ids: string[]): void;
    /** The header checkbox's name. Defaults to "Select all". */
    selectAllLabel?: string;
}

export interface ListTableOptions<T> {
    rows: readonly T[];
    key(row: T): string;
    /** Columns in order; a falsy entry is left out, so optional columns read inline. */
    columns: readonly (ListColumn<T> | false | null | undefined)[];
    /** Row checkboxes and the "select all" box. */
    selection?: ListSelection<T>;
    /** What an empty list says. Defaults to "Nothing found.". */
    empty?: string;
    /** The rows' data attribute, such as `data-user`, holding the key: tests and scripts find rows by it. Defaults to `data-row`. */
    rowAttribute?: string;
}

/** The line magnifier, the search box's default icon. */
const SEARCH_ICON: IconEntry = { line: MagnifierIcon };

const TH = 'px-3 py-2 font-medium';
const TD = 'px-3 py-2';

/** The list as a table in a card: a header row, a row per item, and the empty text when there are none. */
export function listTable<T>(options: ListTableOptions<T>): TemplateResult {
    const columns = options.columns.filter((column): column is ListColumn<T> => !!column);
    const selection = options.selection;
    const selectable = selection ? selection.selectable ?? options.rows.map(options.key) : [];
    const attribute = options.rowAttribute ?? 'data-row';
    return component(Card, {}, component(CardBody, { class: 'p-0' }, html`
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead><tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    ${selection ? html`<th class="w-10 px-3 py-2">${selectAllBox(selectable, selection.selected, ids => selection.change(ids), selection.selectAllLabel)}</th>` : null}
                    ${columns.map(column => html`<th class=${`${TH} ${column.class ?? ''}`} aria-sort=${column.sort ?? 'none'}>${column.label}</th>`)}
                </tr></thead>
                <tbody>${options.rows.map(row => {
                    const key = options.key(row);
                    const chosen = selection?.selected.includes(key) === true;
                    return html`<tr class=${`group border-b border-border last:border-0 align-top ${chosen ? 'bg-primary/5' : ''}`} ...=${{ [attribute]: key }}>
                        ${selection ? html`<td class=${TD}>${selectable.includes(key) ? selectBox(key, selection.label(row), selection.selected, ids => selection.change(ids)) : null}</td>` : null}
                        ${columns.map(column => html`<td class=${`${TD} ${column.class ?? ''}`}>${column.cell(row)}</td>`)}
                    </tr>`;
                })}</tbody>
            </table>
            ${options.rows.length ? null : html`<p class="px-3 py-8 text-center text-sm text-muted-foreground">${options.empty ?? 'Nothing found.'}</p>`}
        </div>`));
}

export interface ListFiltersOptions {
    /** The list's address; the form submits to it with GET. */
    action: string;
    /** Values the form keeps, such as the sort, as hidden inputs. */
    hidden?: Readonly<Record<string, string>>;
    /** The search box: its query name, value and placeholder (also its accessible name). */
    search: { name: string; value: string; placeholder: string };
    /** More filters before the search box, such as a role or a language select. */
    filters?: TemplateResult | null;
    id?: string;
    /** The button's text. Defaults to "Filter". */
    filterLabel?: string;
    /** The search box's icon. Defaults to Solar's line magnifier. */
    searchIcon?: IconEntry;
}

/** The filter bar above a list: its filters, a search box with its icon, and the Filter button. */
export function listFilters(options: ListFiltersOptions): TemplateResult {
    return html`<form method="get" action=${options.action} class="flex flex-wrap items-center gap-2" role="search" id=${ifDefined(options.id)}>
        ${Object.entries(options.hidden ?? {}).filter(([, value]) => value !== '').map(([name, value]) => html`<input type="hidden" name=${name} value=${value}>`)}
        ${options.filters ?? null}
        <div class="relative w-64 max-w-full">
            <span aria-hidden="true" class="pointer-events-none absolute left-2.5 top-1/2 inline-flex -translate-y-1/2 text-muted-foreground [&_svg]:size-4">${component(Icon, { entry: options.searchIcon ?? SEARCH_ICON, size: 16 })}</span>
            ${component(Input, { type: 'search', name: options.search.name, value: options.search.value, size: 'sm', class: 'pl-8', placeholder: options.search.placeholder, 'aria-label': options.search.placeholder })}
        </div>
        ${component(Button, { type: 'submit', size: 'sm', variant: 'outline' }, options.filterLabel ?? 'Filter')}
    </form>`;
}

export interface ListFooterLabels {
    /** After a count of one. Defaults to "item". */
    item?: string;
    /** After any other count. Defaults to "items". */
    items?: string;
    /** The pagination's name. Defaults to "Pagination". */
    pagination?: string;
    /** Defaults to "Previous page". */
    previous?: string;
    /** Defaults to "Next page". */
    next?: string;
    /** A page button's name. Defaults to `Page ${page}`. */
    page?(page: number): string;
}

export interface ListFooterOptions {
    total: number;
    page: number;
    totalPages: number;
    /** The count is what was found so far, and more follow (a search): it shows as `20+`. */
    more?: boolean;
    href(page: number): string;
    labels?: ListFooterLabels;
}

/** The count and, past one page, the pages under a list. */
export function listFooter(options: ListFooterOptions): TemplateResult {
    const { item = 'item', items = 'items', pagination = 'Pagination', previous = 'Previous page', next = 'Next page', page = (number: number) => `Page ${number}` } = options.labels ?? {};
    return html`<div class="flex flex-col items-center justify-between gap-3 sm:flex-row">
        <p class="text-xs text-muted-foreground">${options.total}${options.more ? '+' : ''} ${options.total === 1 && !options.more ? item : items}</p>
        ${options.totalPages > 1 ? component(Pagination, {
            page: options.page, totalPages: options.totalPages, label: pagination, previousLabel: previous, nextLabel: next,
            pageLabel: page, href: (number: number) => options.href(number),
        }) : null}
    </div>`;
}

/** A row's quick action: a link, or a button that runs `run`. */
export interface RowAction {
    /** Unique on the page, such as `user-<id>-delete`. */
    id: string;
    label: string;
    href?: string;
    run?(): void;
    danger?: boolean;
}

/** A row's quick actions under its title, as words between bars; clearer when the row is hovered or focused. */
export function rowActions(actions: readonly RowAction[]): TemplateResult {
    const separator = html`<span aria-hidden="true" class="text-muted-foreground">|</span>`;
    return html`<div class="mt-1 flex flex-wrap items-center gap-2 text-xs opacity-80 group-hover:opacity-100 focus-within:opacity-100" data-quick-actions>${actions.flatMap((action, index) => {
        const tone = action.danger ? 'text-destructive' : 'text-primary';
        const control = action.href
            ? html`<a href=${action.href} id=${action.id} class=${`${tone} no-underline hover:underline`}>${action.label}</a>`
            : html`<button type="button" id=${action.id} class=${`${tone} cursor-pointer border-none bg-transparent p-0 text-xs hover:underline`} @click=${() => action.run?.()}>${action.label}</button>`;
        return index ? [separator, control] : [control];
    })}</div>`;
}

// --- Tabs --------------------------------------------------------------------------------------

/** A count beside a label, such as a tab's items; nothing when there are none, so an empty tab stays quiet. */
export function countBadge(count: number): TemplateResult {
    if (!count) return html``;
    return html`<span class="ml-1.5 inline-flex align-middle">${component(Badge, { variant: 'default' }, String(count))}</span>`;
}

/** The tab the address names (`?tab=`), when it is one of `values`; the first value otherwise. */
export function tabFromQuery<T extends string>(query: string | undefined, values: readonly T[]): T {
    return values.find(value => value === query) ?? values[0]!;
}

/**
 * Keep the open tab in the address so a reload or a shared link opens it; the first (default)
 * tab drops the parameter. Browser only: it replaces the history entry, and does nothing on the server.
 */
export function rememberTab(value: string, values: readonly string[], name = 'tab'): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (value === values[0]) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    window.history.replaceState(window.history.state, '', url);
}
