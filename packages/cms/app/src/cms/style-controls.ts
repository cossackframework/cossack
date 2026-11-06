/**
 * A block's Style tab, shared by the entry editor, Appearance → Widgets and the editor on the
 * public site: colors from the theme's palette or a color of the block's own, spacing and font
 * size from its presets, text alignment, and under Advanced the block's ID, HTML anchor and class
 * names. Values are preset slugs (or hex colors); `blockStyleAttributes` renders them. Client-safe.
 */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { ColorPicker, Icon, Input, NativeSelect, Popover, Tabs } from '@cossackframework/ui';
import { blockIdProblem, CUSTOM_COLOR, TEXT_ALIGNMENTS, type BlockStyle, type Preset, type StyleProperty, type ThemePresets } from '@cossackframework/cms';
import type { EditorBlock } from './editor';
import { icon } from './icons';

export type BlockTab = 'general' | 'style';

/** What the Style tab edits: the block's `style`, the layout extras, and the block's ID. */
export interface StyleValues {
    style: BlockStyle;
    layout: { anchor?: string; className?: string; nosnippet?: boolean };
    /** The block's `_id` as the editor typed it; applied when it is valid and no other block of the field has it. */
    id?: string;
}

/** What the Style tab needs to know besides the values. */
export interface StyleControlOptions {
    /** The IDs of the field's other blocks, which the block's ID may not repeat. Without it the ID control stays out. */
    taken?: ReadonlySet<string>;
}

/** The style values of a block as editors hold it. */
export function styleValues(block: Pick<EditorBlock, 'style' | 'layout'> & { _id?: string }): StyleValues {
    return { style: { ...block.style }, layout: { anchor: block.layout?.anchor ?? '', className: block.layout?.className ?? '', nosnippet: block.layout?.nosnippet === true }, ...(block._id ? { id: block._id } : {}) };
}

/** The ID a block takes from the Style tab's values: the typed one when it is valid and free, else the block's own. */
export function blockIdOf(block: { _id: string }, values: StyleValues, taken?: ReadonlySet<string>): string {
    const id = values.id?.trim() ?? '';
    return id && id !== block._id && !blockIdProblem(id, taken) ? id : block._id;
}

/** A block with the Style tab's values applied, its hide list kept; `taken` lets a new ID through only when no other block has it. */
export function withStyle<T extends Pick<EditorBlock, 'style' | 'layout'> & { _id: string }>(block: T, values: StyleValues, taken?: ReadonlySet<string>): T {
    const style = Object.fromEntries(Object.entries(values.style).filter(([, value]) => typeof value === 'string' && value)) as BlockStyle;
    const anchor = values.layout.anchor?.trim() ?? '';
    const className = values.layout.className?.trim() ?? '';
    const { anchor: _anchor, className: _className, nosnippet: _nosnippet, ...rest } = block.layout ?? {};
    return { ...block, _id: blockIdOf(block, values, taken), style, layout: { ...rest, ...(anchor ? { anchor } : {}), ...(className ? { className } : {}), ...(values.layout.nosnippet ? { nosnippet: true } : {}) } };
}

const ALIGN_ICONS: Record<(typeof TEXT_ALIGNMENTS)[number], string> = { left: 'align-left', center: 'align-horizontal-center', right: 'align-right' };
const ALIGN_LABELS: Record<(typeof TEXT_ALIGNMENTS)[number], string> = { left: 'Align left', center: 'Align center', right: 'Align right' };
/** The swatch of no color: a slash. */
const NONE = 'background: linear-gradient(135deg, transparent 45%, var(--destructive) 45%, var(--destructive) 55%, transparent 55%)';

/** The two tabs over a block's settings. */
export function blockTabs(active: BlockTab, pick: (tab: BlockTab) => void, idPrefix: string, content: Record<BlockTab, TemplateResult>): TemplateResult {
    return component(Tabs, {
        id: idPrefix, label: __('Block settings'), value: active, variant: 'underline',
        onValueChange: (value: string) => pick(value as BlockTab),
        items: [
            { value: 'general', label: __('General'), content: content.general },
            { value: 'style', label: __('Style'), content: content.style },
        ],
    });
}

/**
 * The Style tab's controls for the properties the block supports. `change` receives the whole
 * values each time, so a screen keeps them as it keeps a form's values.
 */
export function styleControls(values: StyleValues, supports: readonly StyleProperty[], presets: Required<ThemePresets>, idPrefix: string, change: (values: StyleValues) => void, options: StyleControlOptions = {}): TemplateResult {
    const has = (property: StyleProperty) => supports.includes(property);
    const set = (property: StyleProperty, value: string) => change({ ...values, style: { ...values.style, [property]: value || undefined } });
    const setLayout = (key: 'anchor' | 'className', value: string) => change({ ...values, layout: { ...values.layout, [key]: value } });
    const colors = (property: 'background' | 'text', label: string) => colorControl(`${idPrefix}-${property}`, label, presets.colors, values.style[property] ?? '', value => set(property, value));
    const select = (property: 'padding' | 'margin' | 'fontSize', label: string, options: readonly Preset[]) => {
        const id = `${idPrefix}-${property}`;
        return html`<div class="min-w-0 space-y-1">
            <label for=${id} class="block text-xs font-medium text-foreground">${label}</label>
            ${component(NativeSelect, { id, '@change': (event: Event) => set(property, (event.target as HTMLSelectElement).value) }, html`
                <option value="" ?selected=${!values.style[property]}>${__('Default')}</option>
                ${options.map(preset => html`<option value=${preset.slug} ?selected=${preset.slug === values.style[property]}>${preset.name}</option>`)}`)}
        </div>`;
    };
    const short = [
        ...(has('padding') ? [select('padding', __('Padding'), presets.spacing)] : []),
        ...(has('margin') ? [select('margin', __('Margin'), presets.spacing)] : []),
        ...(has('fontSize') ? [select('fontSize', __('Font size'), presets.fontSizes)] : []),
        ...(has('align') ? [alignControl(values.style.align ?? '', value => set('align', value))] : []),
    ];
    const idTyped = values.id?.trim() ?? '';
    const idError = options.taken && idTyped ? blockIdProblem(idTyped, options.taken) : undefined;
    return html`<div class="space-y-3" data-style-controls>
        ${!supports.length ? html`<p class="text-sm text-muted-foreground">${__('This block has no style settings.')}</p>` : null}
        ${has('background') ? colors('background', __('Background')) : null}
        ${has('text') ? colors('text', __('Text color')) : null}
        ${short.length ? html`<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${short}</div>` : null}
        <details class="rounded-md border border-border">
            <summary class="cursor-pointer px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">${__('Advanced')}</summary>
            <div class="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
                ${options.taken ? html`<div class="min-w-0 space-y-1 sm:col-span-2">
                    <label for=${`${idPrefix}-id`} class="block text-xs font-medium text-foreground">${__('Block ID')}</label>
                    ${component(Input, { id: `${idPrefix}-id`, type: 'text', maxlength: 40, 'aria-invalid': idError ? 'true' : 'false', '.value': values.id ?? '',
                        // Applied when the field is left, not on every keystroke: a half-typed ID would re-key the block each time.
                        '@change': (event: Event) => change({ ...values, id: (event.target as HTMLInputElement).value.trim() }) })}
                    ${idError ? html`<p role="alert" class="text-xs text-destructive">${__(idError)}</p>`
                        : html`<p class="text-xs text-muted-foreground">${__('For code and the API: letters, digits, _ or -, unique in this field. Themes and bindings read the block by it ({{ $.content#id.field }}); notes on the block stay with its old ID.')}</p>`}
                </div>` : null}
                <div class="min-w-0 space-y-1">
                    <label for=${`${idPrefix}-anchor`} class="block text-xs font-medium text-foreground">${__('HTML anchor')}</label>
                    ${component(Input, { id: `${idPrefix}-anchor`, type: 'text', maxlength: 60, '.value': values.layout.anchor ?? '', '@input': (event: Event) => setLayout('anchor', (event.target as HTMLInputElement).value) })}
                    <p class="text-xs text-muted-foreground">${__('Lets links jump to this block: a letter, then letters, digits, _ or -.')}</p>
                </div>
                <div class="min-w-0 space-y-1">
                    <label for=${`${idPrefix}-class`} class="block text-xs font-medium text-foreground">${__('Additional classes')}</label>
                    ${component(Input, { id: `${idPrefix}-class`, type: 'text', maxlength: 200, '.value': values.layout.className ?? '', '@input': (event: Event) => setLayout('className', (event.target as HTMLInputElement).value) })}
                    <p class="text-xs text-muted-foreground">${__('Separated by spaces, for the theme\'s stylesheet.')}</p>
                </div>
                <label class="flex items-center gap-2 text-xs text-foreground cursor-pointer sm:col-span-2">
                    <input type="checkbox" .checked=${values.layout.nosnippet === true} @change=${(event: Event) => change({ ...values, layout: { ...values.layout, nosnippet: (event.target as HTMLInputElement).checked } })}>
                    ${__('Keep out of snippets and AI answers (data-nosnippet)')}
                </label>
            </div>
        </details>
    </div>`;
}

/**
 * A color: a box showing the current one, which opens a picker with the theme's palette (as
 * swatches, with None) and a custom color (the browser's picker, or a hex code). The value is a
 * preset's slug or the hex color.
 */
function colorControl(id: string, label: string, colors: readonly Preset[], value: string, set: (value: string) => void): TemplateResult {
    const preset = colors.find(entry => entry.slug === value);
    const custom = !preset && CUSTOM_COLOR.test(value) ? value.toLowerCase() : '';
    const current = preset?.value ?? custom;
    // Picking from the palette is the whole choice: the picker closes. The custom color stays open while it is typed.
    const pick = (slug: string) => { set(slug); (document.getElementById(`${id}-picker-content`) as HTMLElement & { hidePopover?(): void } | null)?.hidePopover?.(); };
    const swatch = (slug: string, name: string, color: string | null) => html`<button type="button" role="radio" aria-checked=${value === slug ? 'true' : 'false'} title=${name} aria-label=${name}
        class=${`h-7 w-7 rounded-md border cursor-pointer ${value === slug ? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-background' : 'border-border hover:border-foreground'}`}
        style=${color ? `background: ${color}` : NONE}
        @click=${() => pick(slug)}></button>`;
    return html`<div class="space-y-1" data-color-control>
        <span id=${id} class="block text-xs font-medium text-foreground">${label}</span>
        ${component(Popover, {
            id: `${id}-picker`, side: 'bottom', align: 'start', 'aria-labelledby': id,
            class: 'w-full justify-start gap-2 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground hover:bg-muted',
            trigger: html`<span aria-hidden="true" class="inline-block h-5 w-5 shrink-0 rounded border border-border" style=${current ? `background: ${current}` : NONE}></span>
                <span class="min-w-0 truncate">${preset ? preset.name : custom || __('None')}</span>`,
            contentProps: { 'aria-label': `${label}: ${__('choose a color')}`, class: 'w-72 space-y-3 text-sm' },
        }, html`
            <div class="space-y-1.5">
                <p class="text-xs font-medium text-muted-foreground">${__('Theme colors')}</p>
                ${colors.length ? html`<div role="radiogroup" aria-label=${label} class="flex flex-wrap items-center gap-1.5">
                    ${swatch('', __('None'), null)}
                    ${colors.map(entry => swatch(entry.slug, entry.name, entry.value))}
                </div>` : html`<p class="text-xs text-muted-foreground">${__('The theme has no colors. Add some under Appearance → Customize.')}</p>`}
            </div>
            <div class="space-y-1.5">
                <p class="text-xs font-medium text-muted-foreground">${__('Custom color')}</p>
                <div class="flex items-center gap-2">
                    ${component(ColorPicker, { id: `${id}-custom`, label: `${label}: ${__('pick a color')}`, value: custom || current || '#000000', onChange: (color: string) => set(color.toLowerCase()) })}
                    ${component(Input, { id: `${id}-hex`, type: 'text', maxlength: 9, placeholder: '#336699', 'aria-label': `${label}: ${__('hex color')}`, '.value': custom,
                        '@change': (event: Event) => { const text = (event.target as HTMLInputElement).value.trim(); if (!text || CUSTOM_COLOR.test(text)) set(text.toLowerCase()); } })}
                </div>
            </div>`)}
    </div>`;
}

/** Left, centre and right, as a toggle group. Pressing the active one clears it. */
function alignControl(value: string, set: (value: string) => void): TemplateResult {
    return html`<div class="min-w-0 space-y-1">
        <span class="block text-xs font-medium text-foreground">${__('Alignment')}</span>
        <div role="group" class="flex gap-1">${TEXT_ALIGNMENTS.map(align => html`<button type="button" aria-pressed=${value === align ? 'true' : 'false'} title=${__(ALIGN_LABELS[align])} aria-label=${__(ALIGN_LABELS[align])}
            class=${`inline-flex h-8 w-8 items-center justify-center rounded border cursor-pointer [&_svg]:size-4 ${value === align ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            @click=${() => set(value === align ? '' : align)}>${component(Icon, { entry: icon(ALIGN_ICONS[align]), size: 16 })}</button>`)}</div>
    </div>`;
}
