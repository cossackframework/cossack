/**
 * Form controls for entry and block fields, shared by the entry editor, Appearance → Widgets
 * and the editor on the public site. Client-safe. Media fields show their files with Choose and
 * Remove buttons; the screen opens its own media chooser.
 */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Button, Checkbox, CodeEditor, DropdownMenu, Icon, Input, NativeSelect, Textarea } from '@cossackframework/ui';
import { hasBinding, ITEM_LIMITS, mediaKind, withBinding } from '@cossackframework/cms';
import type { BlockOption, EditorField } from './editor';
import { icon } from './icons';
import { iconButton } from './ui';

/** A file as media controls preview it. */
export interface MediaPreview { id: string; url: string; title: string; alt: string; contentType: string; width: number | null; height: number | null }

/** How a media control shows and changes its files. */
export interface MediaHooks {
    previews: Record<string, MediaPreview>;
    /** Open the screen's media chooser for this field. */
    choose(multiple: boolean): void;
}

/** A field of the entry a block's text may show: `{{ $.name }}` on the site becomes the entry's value. */
export interface BindingChoice { name: string; label: string }

/** A list of binding choices from editor fields: the kinds whose values read as text. */
export function bindingChoices(fields: readonly Pick<EditorField, 'name' | 'label' | 'kind' | 'media'>[]): BindingChoice[] {
    return fields.filter(field => !field.media && ['string', 'text', 'integer', 'number', 'boolean', 'enum', 'datetime', 'reference'].includes(field.kind))
        .map(field => ({ name: field.name, label: field.label }));
}

/**
 * The control for one field, or null for kinds a screen renders itself (blocks, rich text).
 * `options` lists a reference field's choices.
 */
export function fieldControl(field: EditorField, value: unknown, change: (value: unknown) => void, id: string,
    extra: { media?: MediaHooks; options?: readonly { id: string; title: string }[]; /** Entry fields the text may bind to; a picker button offers them. */ bindings?: readonly BindingChoice[]; /** The language of a code field, from the block's `language` field. */ language?: string } = {}): TemplateResult | null {
    const input = (type: 'text' | 'number' | 'datetime-local') => component(Input, { id, type, '.value': String(value ?? ''), step: field.kind === 'integer' ? 1 : 'any',
        ...(field.kind === 'string' && field.max ? { maxlength: field.max } : {}), '@input': (event: Event) => change((event.target as HTMLInputElement).value) });
    const textarea = (rows: number, className = '') => component(Textarea, { id, rows, ...(className ? { class: className } : {}), '.value': String(value ?? ''),
        '@input': (event: Event) => change((event.target as HTMLTextAreaElement).value) });
    // Text may show an entry field instead: the picker beside the control writes the binding.
    const bindable = (control: TemplateResult) => extra.bindings !== undefined ? bindingControl(control, value, change, id, extra.bindings) : control;
    if (field.multiple && !field.media) {
        if (field.kind === 'enum') return choicesControl(field, value, change, id);
        return multipleControl(field, value, change, id, (item, itemChange, itemId) => fieldControl({ ...field, multiple: false }, item, itemChange, itemId, extra) ?? html``);
    }
    switch (field.kind) {
        case 'boolean': return html`<label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            ${component(Checkbox, { id, checked: value === true, '@change': (event: Event) => change((event.target as HTMLInputElement).checked) })} ${field.label}</label>`;
        case 'enum': return component(NativeSelect, { id, '@change': (event: Event) => change((event.target as HTMLSelectElement).value) }, html`
            ${field.required ? null : html`<option value="" ?selected=${!value}>—</option>`}
            ${field.choices.map(choice => html`<option value=${choice.value} ?selected=${choice.value === value}>${choice.label}</option>`)}`);
        case 'integer': case 'number': return input('number');
        case 'datetime': return input('datetime-local');
        case 'reference': return component(NativeSelect, { id, '@change': (event: Event) => change((event.target as HTMLSelectElement).value) }, html`
            <option value="" ?selected=${!value}>—</option>
            ${(extra.options ?? []).map(option => html`<option value=${option.id} ?selected=${option.id === value}>${option.title}</option>`)}`);
        case 'json': return field.fields.length
            ? groupFields(field, value, change, id, (sub, subValue, subChange, subId) => fieldControl(sub, subValue, subChange, subId, extra) ?? html``)
            : textarea(6, 'font-mono text-xs');
        // Markdown in a block is a short passage: a compact box that grows with its text, no tabs or toolbar.
        case 'text': return field.format === 'markdown'
            ? html`<div class="space-y-1">${bindable(textarea(3, 'field-sizing-content min-h-[4.5rem] max-h-[40vh]'))}<p class="text-xs text-muted-foreground">${__('Markdown: **bold**, _italic_, [link](https://…). Blocks: {{ block core/button label="Buy" url="/cart" /}}.')}</p></div>`
            : field.format === 'code' ? component(CodeEditor, { id, value: String(value ?? ''), language: extra.language ?? '', label: field.label, onChange: (next: string) => change(next) })
            : bindable(textarea(4));
        case 'blocks': case 'richtext': case 'vector': case 'bigint': return null;
        default: return field.media && extra.media ? mediaControl(value, change, field.label, field.multiple, extra.media) : bindable(input('text'));
    }
}

/** A multiple choice: one checkbox per choice, the ticked values kept in the choices' order. */
export function choicesControl(field: EditorField, value: unknown, change: (value: unknown) => void, id: string): TemplateResult {
    const chosen = Array.isArray(value) ? value.map(String) : [];
    const toggle = (entry: string, on: boolean) => change(field.choices.map(choice => choice.value).filter(candidate => candidate === entry ? on : chosen.includes(candidate)));
    return html`<div id=${id} class="space-y-1.5">${field.choices.map(choice => html`<label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
        ${component(Checkbox, { checked: chosen.includes(choice.value), '@change': (event: Event) => toggle(choice.value, (event.target as HTMLInputElement).checked) })} ${choice.label}</label>`)}</div>`;
}

/** The value a new item of a multiple field starts with: nothing of its kind. */
function emptyItem(field: EditorField): unknown {
    return field.kind === 'richtext' ? null : '';
}

/**
 * A multiple field: the kind's control once per item, each with Move up, Move down and
 * Remove, and the Add button below, within the field's fewest and most items. `item`
 * renders one value's control with its own id.
 */
export function multipleControl(field: EditorField, value: unknown, change: (value: unknown) => void, id: string,
    item: (value: unknown, change: (value: unknown) => void, id: string, index: number) => TemplateResult): TemplateResult {
    const items = Array.isArray(value) ? value : [];
    const fewest = field.minItems ?? 0;
    const most = field.maxItems ?? (field.kind === 'reference' ? ITEM_LIMITS.media : ITEM_LIMITS.max);
    const set = (next: unknown[]) => change(next);
    const label = (index: number) => `${field.label} ${index + 1}`;
    return html`<div id=${id} class="space-y-2" data-cms-multiple=${field.name}>
        ${items.map((entry, index) => html`<div class="flex items-start gap-1" data-cms-item>
            <div class="min-w-0 flex-1">${item(entry, next => set(items.map((current, at) => at === index ? next : current)), `${id}-${index}`, index)}</div>
            ${iconButton(`${id}-${index}-up`, 'arrow-up', `${__('Move up')} ${label(index)}`, () => set(moveItem(items, index, -1)), { disabled: index === 0 })}
            ${iconButton(`${id}-${index}-down`, 'arrow-down', `${__('Move down')} ${label(index)}`, () => set(moveItem(items, index, 1)), { disabled: index === items.length - 1 })}
            ${iconButton(`${id}-${index}-remove`, 'trash-bin-trash', `${__('Remove')} ${label(index)}`, () => set(items.filter((_, at) => at !== index)), { danger: true, disabled: items.length <= fewest })}
        </div>`)}
        ${component(Button, { type: 'button', variant: 'outline', size: 'sm', disabled: items.length >= most, '@click': () => set([...items, emptyItem(field)]) }, field.addLabel || __('Add new'))}
    </div>`;
}

/**
 * A text control with a picker of the entry's fields beside it. Picking one appends `{{ $.name }}`
 * to its text; the site shows the entry's value there, with the words around it.
 */
export function bindingControl(control: TemplateResult, value: unknown, change: (value: unknown) => void, id: string, choices: readonly BindingChoice[]): TemplateResult {
    const bound = hasBinding(value);
    // The button is always there, so people learn that text can show a field; without fields it says why it is off.
    const none = __('This entry has no fields a block can show. Add fields to the collection or a field group.');
    return html`<div class="space-y-1">
        <div class="flex items-start gap-1.5">
            <div class="min-w-0 flex-1">${control}</div>
            ${!choices.length ? html`<button type="button" id=${`${id}-bind`} disabled title=${none} aria-label=${__('Show a field of the entry')}
                class="inline-flex h-9 w-9 shrink-0 cursor-not-allowed items-center justify-center rounded-md border border-input bg-background text-muted-foreground opacity-50 [&_svg]:size-4">${component(Icon, { entry: icon('database'), size: 16 })}</button>`
            : component(DropdownMenu, { id: `${id}-bind`, side: 'bottom', align: 'end', 'aria-label': __('Show a field of the entry'), title: __('Show a field of the entry'),
                class: `inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-background [&_svg]:size-4 ${bound ? 'border-primary text-primary' : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground'}`,
                trigger: component(Icon, { entry: icon('database'), size: 16 }) }, html`
                <p class="px-2 py-1.5 text-xs text-muted-foreground">${__('Show the value of')}</p>
                ${choices.map(choice => html`<button type="button" role="menuitem" tabindex="-1" class="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted cursor-pointer border-none bg-transparent"
                    @click=${() => change(withBinding(value, choice.name))}><span class="truncate">${choice.label}</span><code class="shrink-0 text-xs text-muted-foreground">{{ $.${choice.name} }}</code></button>`)}`)}
        </div>
        ${bound ? html`<p class="text-xs text-muted-foreground">${__('On the site, each {{ $.name }} is replaced by that field of the entry.')}</p>` : null}
    </div>`;
}

/** A media field: its files, with Remove buttons, and a button that opens the chooser. */
export function mediaControl(value: unknown, change: (value: unknown) => void, label: string, multiple: boolean, media: MediaHooks): TemplateResult {
    const ids = Array.isArray(value) ? value as string[] : typeof value === 'string' && value ? [value] : [];
    const remove = (id: string) => change(multiple ? ids.filter(entry => entry !== id) : null);
    return html`<div class="space-y-2">
        ${ids.length ? html`<div class=${multiple ? 'grid grid-cols-3 gap-2' : ''}>${ids.map(id => {
            const file = media.previews[id];
            return html`<figure class="group relative overflow-hidden rounded-md border border-border bg-muted">
                ${file && mediaKind(file.contentType) === 'image'
                    ? html`<img src=${file.url} alt=${file.alt} class="aspect-video w-full object-cover" loading="lazy">`
                    : html`<p class="p-3 text-xs text-muted-foreground">${file?.title ?? id}</p>`}
                <button type="button" class="absolute right-1 top-1 rounded bg-background/90 px-2 py-0.5 text-xs text-destructive border border-border cursor-pointer"
                    @click=${() => remove(id)} aria-label=${`${__('Remove')} ${file?.title ?? ''}`}>${__('Remove')}</button>
            </figure>`;
        })}</div>` : null}
        ${component(Button, { type: 'button', variant: 'outline', size: 'sm', '@click': () => media.choose(multiple) },
            ids.length && !multiple ? `${__('Replace')} ${label.toLowerCase()}` : `${__('Choose')} ${label.toLowerCase()}`)}
    </div>`;
}

/**
 * A group field (`field.group`, such as a form's settings) as a box of its subfields, one
 * labelled control each. `render` draws a subfield's control; its change writes the subfield
 * into the group's object.
 */
export function groupFields(field: EditorField, value: unknown, change: (value: unknown) => void, id: string,
    render: (sub: EditorField, value: unknown, change: (value: unknown) => void, id: string) => TemplateResult): TemplateResult {
    const object = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return html`<div id=${id} class="space-y-4 rounded-md border border-border p-3">${field.fields.map(sub => {
        const subId = `${id}-${sub.name}`;
        return html`<div class="space-y-1">
            ${sub.kind === 'boolean' ? null : html`<label for=${subId} class="block text-sm font-medium text-foreground">${sub.label}${sub.required ? html`<span class="text-destructive"> *</span>` : null}</label>`}
            ${render(sub, object[sub.name], next => change({ ...object, [sub.name]: next }), subId)}
            ${sub.description ? html`<p class="text-xs text-muted-foreground">${sub.description}</p>` : null}
        </div>`;
    })}</div>`;
}

/** A block's fields as a form: one labelled control each. `errors` are keyed by field name. */
export function blockFields(option: BlockOption, values: Record<string, unknown>, change: (name: string, value: unknown) => void, idPrefix: string,
    media: (name: string) => MediaHooks, errors: Record<string, string> = {}, bindings: readonly BindingChoice[] = []): TemplateResult {
    return html`${option.fields.map(entry => {
        const id = `${idPrefix}-${entry.name}`;
        return html`<div class="space-y-1">
            ${entry.kind === 'boolean' ? null : html`<label for=${id} class="block text-sm font-medium text-foreground">${entry.label}${entry.required ? ' *' : ''}</label>`}
            ${fieldControl(entry, values[entry.name], value => change(entry.name, value), id, { media: media(entry.name), bindings, language: String(values.language ?? '') })}
            ${entry.description ? html`<p class="text-xs text-muted-foreground">${entry.description}</p>` : null}
            ${errors[entry.name] ? html`<p role="alert" class="text-xs text-destructive">${entry.label} ${errors[entry.name]}</p>` : null}
        </div>`;
    })}`;
}

/** Move one item of a list by `delta` places; the list unchanged when it would leave the ends. */
export function moveItem<T>(items: readonly T[], index: number, delta: number): T[] {
    const target = index + delta;
    if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [...items];
    const moved = [...items];
    const [item] = moved.splice(index, 1);
    moved.splice(target, 0, item!);
    return moved;
}
