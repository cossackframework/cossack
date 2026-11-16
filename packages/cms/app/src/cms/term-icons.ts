/** The icon picker of taxonomy terms and collections: the whole catalog, searchable and by category. Client-safe. */
import { component, type TemplateResult } from '@cossackframework/renderer';
import { Field, IconPicker } from '@cossackframework/ui';
import { ICON_CATALOG } from './icons';

/** An icon field: every icon of the catalog, searched or browsed by category. `allowEmpty` offers None. */
export function iconSelect(id: string, value: string, change: (value: string) => void, error?: string, options: { hint?: string; allowEmpty?: boolean } = {}): TemplateResult {
    return component(Field, { label: __('Icon'), for: `${id}-picker`, ...(error ? { error } : {}), hint: options.hint ?? __('Shown beside the term in menus and lists.'),
        control: () => component(IconPicker, { id, value, icons: ICON_CATALOG, label: __('Icon'), allowEmpty: options.allowEmpty !== false, onChange: (name: string) => change(name) }) });
}
