/** The icon picker of taxonomy terms: a select of the dashboard's icon names, with a preview of the choice. Client-safe. */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Field, Icon, NativeSelect } from '@cossackframework/ui';
import { COLLECTION_ICONS, icon } from './icons';

/** Icons offered for terms: the collection icons and a few that suit categories and tags. */
export const TERM_ICONS: readonly string[] = Object.freeze(['tag', 'folder', 'hashtag', 'bookmark', 'star', 'heart', 'flag', 'pin', 'lightbulb', 'bolt', 'global', 'map', 'crown', 'gift', 'rocket', ...COLLECTION_ICONS].filter((name, index, all) => all.indexOf(name) === index));

export function iconSelect(id: string, value: string, change: (value: string) => void, error?: string): TemplateResult {
    return component(Field, { label: __('Icon'), for: id, ...(error ? { error } : {}), hint: __('Shown beside the term in menus and lists.'),
        control: attributes => html`<div class="flex items-center gap-2">
            <span class=${`inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border ${value ? 'text-foreground' : 'text-muted-foreground'} [&_svg]:size-4`} aria-hidden="true">${value ? component(Icon, { entry: icon(value), size: 16 }) : '—'}</span>
            ${component(NativeSelect, { ...attributes, '@change': (event: Event) => change((event.target as HTMLSelectElement).value) }, html`
                <option value="" ?selected=${!value}>${__('None')}</option>
                ${TERM_ICONS.map(name => html`<option value=${name} ?selected=${name === value}>${name}</option>`)}`)}
        </div>` });
}
