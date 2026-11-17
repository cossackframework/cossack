/**
 * The dashboard's lists (entries, users, roles, forms), from `@cossackframework/ui/blocks` with
 * the dashboard's translations and icon style. Selection goes with `bulkBar` from `./bulk`.
 */
import type { TemplateResult } from '@cossackframework/renderer';
import * as blocks from '@cossackframework/ui/blocks';
import type { ListFiltersOptions, ListFooterOptions, ListTableOptions } from '@cossackframework/ui/blocks';
import { shellIcons } from './icons';

export type { ListColumn, RowAction } from '@cossackframework/ui/blocks';
export { rowActions } from '@cossackframework/ui/blocks';

/** The list as a table in a card; a row's checkbox reads "Select <label>". */
export function listTable<T>(options: ListTableOptions<T>): TemplateResult {
    const selection = options.selection && { ...options.selection, selectAllLabel: __('Select all'), label: (row: T) => `${__('Select')} ${options.selection!.label(row)}` };
    return blocks.listTable({ ...options, selection, empty: options.empty ?? __('Nothing found.') });
}

/** The filter bar above a list. */
export function listFilters(options: ListFiltersOptions): TemplateResult {
    return blocks.listFilters({ filterLabel: __('Filter'), searchIcon: shellIcons().search, ...options });
}

/** The count and pages under a list. */
export function listFooter(options: Omit<ListFooterOptions, 'labels'>): TemplateResult {
    return blocks.listFooter({ ...options, labels: { item: __('item'), items: __('items'), pagination: __('Pagination'), previous: __('Previous page'), next: __('Next page'),
        page: (page: number) => `${__('Page')} ${page}` } });
}
