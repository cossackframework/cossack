import { html, repeat } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';

export interface DataTableSort { columnId: string; direction: 'asc' | 'desc' }
export interface DataTableState {
    /** One-based page. The parent fetches the matching rows. */
    page: number;
    pageSize: number;
    filter: string;
    sort?: DataTableSort;
}
export type DataTableColumn<Row> = {
    /** Stable column identity, also used by sort requests. */
    id: string;
    header: string;
    sortable?: boolean;
    /** Optional rich cell template. Without this, values render as escaped text. */
    cell?: (row: Row) => unknown;
} & ({ key: keyof Row; accessor?: never } | { key?: never; accessor: (row: Row) => unknown });

export type DataTableProps<Row> = {
    /** Current server page only. The table never sorts, filters or slices it. */
    rows: readonly Row[];
    columns: readonly DataTableColumn<Row>[];
    /** Stable, nonempty identity across pages and requests. Never use the row index. */
    getRowId: (row: Row) => string;
    /** Visible accessible table name. */
    caption: string;
    state: DataTableState;
    /** Total matching rows, not the size of this page. */
    rowCount: number;
    /** Replace parent query state and load its rows. Sort/filter/page-size changes reset page to 1. */
    onStateChange: (state: DataTableState) => void;
    loading?: boolean;
    error?: string | null;
    onRetry?: () => void;
    emptyMessage?: string;
    filterLabel?: string;
    pageSizeOptions?: readonly number[];
    /** Controlled IDs. Off-page IDs are preserved. Clear them explicitly when your policy requires it. */
    selection?: ReadonlySet<string>;
    onSelectionChange?: (selection: Set<string>) => void;
    isRowSelectable?: (row: Row) => boolean;
    /** Accessible row selection name. Defaults to the stable ID. */
    rowLabel?: (row: Row) => string;
};

/** Controlled server-data table. Data access and authorization belong to the parent. */
@Component()
export class DataTable<Row> extends Cossack {
    declare props: DataTableProps<Row>;

    private view() {
        const p = this.props;
        const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
        if (!positive(p.state.page) || !positive(p.state.pageSize) || !Number.isSafeInteger(p.rowCount) || p.rowCount < 0) {
            throw new Error('DataTable requires positive page/pageSize and a nonnegative rowCount.');
        }
        if (typeof p.caption !== 'string' || !p.caption.trim() || !p.columns.length) throw new Error('DataTable requires a caption and columns.');
        const columns = new Set<string>();
        for (const column of p.columns) {
            if (!column.id || !column.header.trim() || columns.has(column.id)) throw new Error('DataTable columns require unique nonempty IDs and nonempty headers.');
            columns.add(column.id);
        }
        if (p.state.sort && (!p.columns.some(column => column.id === p.state.sort!.columnId && column.sortable)
            || !['asc', 'desc'].includes(p.state.sort.direction))) throw new Error('DataTable sort must reference a sortable column.');
        if ((p.selection !== undefined) !== (p.onSelectionChange !== undefined)) throw new Error('DataTable selection requires both a value and callback.');
        const ids = new Set<string>();
        const rows = p.rows.map(row => {
            const id = p.getRowId(row);
            if (typeof id !== 'string' || !id || ids.has(id)) throw new Error('DataTable row IDs must be unique nonempty strings.');
            ids.add(id);
            return { row, id, selectable: p.isRowSelectable?.(row) !== false };
        });
        const sizes = [...new Set([...(p.pageSizeOptions ?? [10, 25, 50]), p.state.pageSize])];
        if (!sizes.every(positive)) throw new Error('DataTable page sizes must be positive integers.');
        return { rows, sizes, pages: Math.max(1, Math.ceil(p.rowCount / p.state.pageSize)) };
    }

    private change(patch: Partial<DataTableState>) {
        const state = { ...this.props.state, ...patch };
        if (state.sort) state.sort = { ...state.sort };
        this.props.onStateChange(state);
    }

    /** Selection changes only the current visible, selectable IDs. It never mutates the supplied set. */
    selectVisible(checked: boolean) {
        if (this.props.loading || this.props.error || !this.props.selection || !this.props.onSelectionChange) return;
        const next = new Set(this.props.selection);
        for (const item of this.view().rows) if (item.selectable) {
            if (checked) next.add(item.id); else next.delete(item.id);
        }
        this.props.onSelectionChange(next);
    }

    selectRow(id: string, checked: boolean) {
        if (this.props.loading || this.props.error || !this.props.selection || !this.props.onSelectionChange) return;
        const item = this.view().rows.find(row => row.id === id);
        if (!item?.selectable) return;
        const next = new Set(this.props.selection);
        if (checked) next.add(id); else next.delete(id);
        this.props.onSelectionChange(next);
    }

    sortColumn(id: string) {
        if (!this.props.columns.some(column => column.id === id && column.sortable)) return;
        const old = this.props.state.sort;
        const sort: DataTableSort | undefined = old?.columnId !== id ? { columnId: id, direction: 'asc' }
            : old.direction === 'asc' ? { columnId: id, direction: 'desc' } : undefined;
        this.change({ sort, page: 1 });
    }

    render() {
        const p = this.props;
        const { rows, sizes, pages } = this.view();
        const selectable = rows.filter(row => row.selectable);
        const selected = selectable.filter(row => p.selection?.has(row.id)).length;
        const all = selectable.length > 0 && selected === selectable.length;
        const mixed = selected > 0 && !all;
        const blocked = !!(p.loading || p.error);
        return html`
            <section class="cs-data-table space-y-3">
                <div class="flex flex-wrap gap-3">
                    <label>${p.filterLabel ?? 'Filter rows'}
                        <input type="search" class="rounded-md border border-input bg-background px-2 py-1 focus-visible:outline-2" value=${p.state.filter} .value=${p.state.filter}
                            @input=${(event: Event) => this.change({ filter: (event.currentTarget as HTMLInputElement).value, page: 1 })} />
                    </label>
                    <label>Rows per page
                        <select class="rounded-md border border-input bg-background px-2 py-1 focus-visible:outline-2" .value=${String(p.state.pageSize)} @change=${(event: Event) => {
                            const pageSize = Number((event.currentTarget as HTMLSelectElement).value);
                            if (this.view().sizes.includes(pageSize)) this.change({ pageSize, page: 1 });
                        }}>
                            ${sizes.map(size => html`<option value=${size} ?selected=${size === p.state.pageSize}>${size}</option>`)}
                        </select>
                    </label>
                </div>
                ${p.error ? html`<div role="alert">${p.error}
                    ${p.onRetry ? html`<button type="button" class="rounded-md border border-input px-2 py-1 focus-visible:outline-2 aria-disabled:opacity-50" ?disabled=${p.loading} @click=${(event: Event) => {
                        // Retry can remove its own button. Move focus to a stable query control first.
                        (event.currentTarget as HTMLElement).closest('.cs-data-table')?.querySelector<HTMLInputElement>('input[type=search]')?.focus();
                        this.props.onRetry?.();
                    }}>Retry</button>` : null}
                </div>` : null}
                <p role="status" aria-live="polite">${p.loading ? 'Loading rows…' : p.error ? 'Rows could not be loaded.' : !rows.length ? p.emptyMessage ?? (p.rowCount ? 'No rows on this page.' : 'No matching rows.') : `${p.rowCount} matching rows.`}</p>
                <div class="overflow-auto">
                    <table class="cs-data-table__table w-full text-sm" aria-busy=${p.loading ? 'true' : 'false'}>
                        <caption>${p.caption}</caption>
                        <thead><tr>
                            ${p.selection ? html`<th scope="col" class="border-b p-2 text-left"><input type="checkbox" class="size-4 accent-primary" aria-label="Select visible rows"
                                .checked=${all} ?checked=${all} .indeterminate=${mixed} aria-checked=${mixed ? 'mixed' : String(all)}
                                ?disabled=${blocked || !selectable.length}
                                @change=${(event: Event) => this.selectVisible((event.currentTarget as HTMLInputElement).checked)} /></th>` : null}
                            ${p.columns.map(column => html`<th scope="col" class="border-b p-2 text-left" aria-sort=${p.state.sort?.columnId === column.id ? p.state.sort.direction === 'asc' ? 'ascending' : 'descending' : column.sortable ? 'none' : undefined}>
                                ${column.sortable ? html`<button type="button" class="rounded-md border border-input px-2 py-1 focus-visible:outline-2 aria-disabled:opacity-50" @click=${() => this.sortColumn(column.id)}>${column.header}</button>` : column.header}
                            </th>`)}
                        </tr></thead>
                        <tbody>${repeat(rows, item => item.id, item => html`<tr>
                            ${p.selection ? html`<td class="border-b p-2"><input type="checkbox" class="size-4 accent-primary" aria-label=${`Select ${p.rowLabel?.(item.row) ?? item.id}`}
                                .checked=${p.selection.has(item.id)} ?checked=${p.selection.has(item.id)} ?disabled=${blocked || !item.selectable}
                                @change=${(event: Event) => this.selectRow(item.id, (event.currentTarget as HTMLInputElement).checked)} /></td>` : null}
                            ${p.columns.map(column => {
                                const value = column.cell ? column.cell(item.row) : column.accessor ? column.accessor(item.row) : item.row[column.key];
                                return html`<td class="border-b p-2">${column.cell ? value : value == null ? '' : String(value)}</td>`;
                            })}
                        </tr>`)}</tbody>
                    </table>
                </div>
                <nav aria-label=${`${p.caption} pages`} class="flex gap-3">
                    <button type="button" class="rounded-md border border-input px-2 py-1 focus-visible:outline-2 aria-disabled:opacity-50" aria-disabled=${String(blocked || p.state.page <= 1)}
                        @click=${() => { if (!this.props.loading && !this.props.error && this.props.state.page > 1) this.change({ page: Math.min(this.props.state.page - 1, this.view().pages) }); }}>Previous page</button>
                    <span>Page ${p.state.page} of ${pages}</span>
                    <button type="button" class="rounded-md border border-input px-2 py-1 focus-visible:outline-2 aria-disabled:opacity-50" aria-disabled=${String(blocked || p.state.page >= pages)}
                        @click=${() => { if (!this.props.loading && !this.props.error && this.props.state.page < this.view().pages) this.change({ page: this.props.state.page + 1 }); }}>Next page</button>
                </nav>
            </section>
        `;
    }
}
