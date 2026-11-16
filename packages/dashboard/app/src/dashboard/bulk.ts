/**
 * Selection and bulk actions shared by the dashboard's lists (entries, users, forms): row and
 * "select all" checkboxes, and the Bulk actions select with its Apply button.
 */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Button, Checkbox, NativeSelect } from '@cossackframework/ui';

/** A bulk action of a list; `confirm` asks first with that text. */
export interface BulkChoice {
    key: string;
    label: string;
    confirm?: string;
}

/** The selection after a row's checkbox changes. */
export function toggleSelected(selected: readonly string[], id: string, checked: boolean): string[] {
    return checked ? [...new Set([...selected, id])] : selected.filter(entry => entry !== id);
}

/** The "select all" checkbox of a table's header, over the rows that can be selected. */
export function selectAllBox(ids: readonly string[], selected: readonly string[], change: (ids: string[]) => void): TemplateResult {
    const all = ids.length > 0 && ids.every(id => selected.includes(id));
    return component(Checkbox, { checked: all, indeterminate: !all && ids.some(id => selected.includes(id)), disabled: ids.length === 0, 'aria-label': __('Select all'),
        '@change': (event: Event) => change((event.target as HTMLInputElement).checked ? [...ids] : []) });
}

/** A row's checkbox; `label` names the row for assistive technology. */
export function selectBox(id: string, label: string, selected: readonly string[], change: (ids: string[]) => void): TemplateResult {
    return component(Checkbox, { checked: selected.includes(id), 'aria-label': `${__('Select')} ${label}`,
        '@change': (event: Event) => change(toggleSelected(selected, id, (event.target as HTMLInputElement).checked)) });
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
}

/** The Bulk actions select, its Apply button and how many rows are selected. */
export function bulkBar(options: BulkBarOptions): TemplateResult {
    return html`<div class="flex flex-wrap items-center gap-2" data-bulk-bar>
        <div class="w-44">${component(NativeSelect, { id: options.id, size: 'sm', 'aria-label': __('Bulk actions'), '@change': (event: Event) => options.choose((event.target as HTMLSelectElement).value) }, html`
            <option value="" ?selected=${!options.value}>${__('Bulk actions')}</option>
            ${options.choices.map(choice => html`<option value=${choice.key} ?selected=${options.value === choice.key}>${choice.label}</option>`)}`)}</div>
        ${component(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: !options.value || !options.count, '@click': () => options.apply() }, __('Apply'))}
        ${options.count ? html`<span class="text-xs text-muted-foreground">${options.count} ${__('selected')}</span>` : null}
    </div>`;
}
