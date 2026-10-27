/** The icon picker of taxonomy terms and collections: the dashboard's icons in a searchable grid. Client-safe. */
import { component, type TemplateResult } from '@cossackframework/renderer';
import { Field, IconPicker } from '@cossackframework/ui';
import { COLLECTION_ICONS, ICONS } from './icons';

/** Icons offered for terms: the collection icons and a few that suit categories and tags. */
export const TERM_ICONS: readonly string[] = Object.freeze(['tag', 'folder', 'hashtag', 'bookmark', 'star', 'heart', 'flag', 'pin', 'lightbulb', 'bolt', 'global', 'map', 'crown', 'gift', 'rocket', ...COLLECTION_ICONS].filter((name, index, all) => all.indexOf(name) === index));

/**
 * An icon field: the dashboard's whole icon set (the names `icon()` renders) in a searchable
 * grid, so nothing is imported beyond what the dashboard already ships. `allowEmpty` offers None.
 */
export function iconSelect(id: string, value: string, change: (value: string) => void, error?: string, options: { hint?: string; allowEmpty?: boolean } = {}): TemplateResult {
    return component(Field, { label: __('Icon'), for: `${id}-picker`, ...(error ? { error } : {}), hint: options.hint ?? __('Shown beside the term in menus and lists.'),
        control: () => component(IconPicker, { id, value, icons: ICONS, label: __('Icon'), allowEmpty: options.allowEmpty !== false, onChange: (name: string) => change(name) }) });
}
