/** Selection and bulk actions of the dashboard's lists, from `@cossackframework/ui/blocks` with the dashboard's translations. */
import type { TemplateResult } from '@cossackframework/renderer';
import * as blocks from '@cossackframework/ui/blocks';
import type { BulkBarOptions } from '@cossackframework/ui/blocks';

export type { BulkChoice } from '@cossackframework/ui/blocks';
export { toggleSelected } from '@cossackframework/ui/blocks';

/** The "select all" checkbox of a table's header. */
export function selectAllBox(ids: readonly string[], selected: readonly string[], change: (ids: string[]) => void): TemplateResult {
    return blocks.selectAllBox(ids, selected, change, __('Select all'));
}

/** A row's checkbox; `label` names the row. */
export function selectBox(id: string, label: string, selected: readonly string[], change: (ids: string[]) => void): TemplateResult {
    return blocks.selectBox(id, `${__('Select')} ${label}`, selected, change);
}

/** The Bulk actions select, its Apply button and how many rows are selected. */
export function bulkBar(options: Omit<BulkBarOptions, 'labels'>): TemplateResult {
    return blocks.bulkBar({ ...options, labels: { bulkActions: __('Bulk actions'), apply: __('Apply'), selected: __('selected') } });
}
