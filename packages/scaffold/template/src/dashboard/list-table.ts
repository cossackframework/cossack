/**
 * The dashboard's lists (entries, users, roles, forms): one table, one filter bar and one footer,
 * so every list reads the same. Filters are a GET form, so the address holds them; selection
 * goes with `bulkBar` from `./bulk`, above and below the table.
 */
import { component, html, ifDefined, type TemplateResult } from '@cossackframework/renderer';
import { Button, Card, CardBody, Icon, Input, Pagination } from '@cossackframework/ui';
import { MagnifierIcon } from '@cossackframework/solar-icons/magnifier/line';
import { selectAllBox, selectBox } from './bulk';

export interface ListColumn<T> {
    /** The header; empty for a column of controls. */
    label: string | TemplateResult;
    cell(row: T): unknown;
    /** Classes for the header and the cells, such as `w-14` or `text-muted-foreground`. */
    class?: string;
    /** How the list is sorted by this column, for `aria-sort`; a sortable header passes a link as its label. */
    sort?: 'ascending' | 'descending' | 'none';
}

export interface ListTableOptions<T> {
    rows: readonly T[];
    key(row: T): string;
    /** Columns in order; a falsy entry is left out, so optional columns read inline. */
    columns: readonly (ListColumn<T> | false | null | undefined)[];
    /** Row checkboxes and the "select all" box. `selectable` limits which rows have one; all by default. */
    selection?: { selected: readonly string[]; selectable?: readonly string[]; label(row: T): string; change(ids: string[]): void };
    /** What an empty list says. */
    empty?: string;
    /** The rows' data attribute, such as `data-user`, holding the key: tests and scripts find rows by it. */
    rowAttribute?: string;
}

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
                    ${selection ? html`<th class="w-10 px-3 py-2">${selectAllBox(selectable, selection.selected, ids => selection.change(ids))}</th>` : null}
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
            ${options.rows.length ? null : html`<p class="px-3 py-8 text-center text-sm text-muted-foreground">${options.empty ?? __('Nothing found.')}</p>`}
        </div>`));
}

export interface ListFiltersOptions {
    /** The list's address; the form submits to it with GET. */
    action: string;
    /** Values the form keeps, such as the sort, as hidden inputs. */
    hidden?: Readonly<Record<string, string>>;
    /** The search box: its query name, value and placeholder. */
    search: { name: string; value: string; placeholder: string };
    /** More filters before the search box, such as a role or a language select. */
    filters?: TemplateResult | null;
    id?: string;
}

/** The filter bar above a list: its filters, a search box with its icon, and the Filter button. */
export function listFilters(options: ListFiltersOptions): TemplateResult {
    return html`<form method="get" action=${options.action} class="flex flex-wrap items-center gap-2" role="search" id=${ifDefined(options.id)}>
        ${Object.entries(options.hidden ?? {}).filter(([, value]) => value !== '').map(([name, value]) => html`<input type="hidden" name=${name} value=${value}>`)}
        ${options.filters ?? null}
        <div class="relative w-64 max-w-full">
            <span aria-hidden="true" class="pointer-events-none absolute left-2.5 top-1/2 inline-flex -translate-y-1/2 text-muted-foreground [&_svg]:size-4">${component(Icon, { entry: { line: MagnifierIcon }, size: 16 })}</span>
            ${component(Input, { type: 'search', name: options.search.name, value: options.search.value, size: 'sm', class: 'pl-8', placeholder: options.search.placeholder, 'aria-label': options.search.placeholder })}
        </div>
        ${component(Button, { type: 'submit', size: 'sm', variant: 'outline' }, __('Filter'))}
    </form>`;
}

/** Below a list: how many items there are and, past one page, the pages. */
export function listFooter(options: { total: number; page: number; totalPages: number; href(page: number): string }): TemplateResult {
    return html`<div class="flex flex-col items-center justify-between gap-3 sm:flex-row">
        <p class="text-xs text-muted-foreground">${options.total} ${options.total === 1 ? __('item') : __('items')}</p>
        ${options.totalPages > 1 ? component(Pagination, {
            page: options.page, totalPages: options.totalPages, label: __('Pagination'), previousLabel: __('Previous page'), nextLabel: __('Next page'),
            pageLabel: (page: number) => `${__('Page')} ${page}`, href: (page: number) => options.href(page),
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
