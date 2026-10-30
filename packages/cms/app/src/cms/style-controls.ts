/**
 * A block's Style tab, shared by the entry editor, Appearance → Widgets and the editor on the
 * public site: colours as swatches of the theme's palette, spacing and font size from its
 * presets, text alignment, and under Advanced the block's HTML anchor and class names.
 * Values are preset slugs; `blockStyleAttributes` renders them. Client-safe.
 */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Icon, Input, NativeSelect } from '@cossackframework/ui';
import { TEXT_ALIGNMENTS, type BlockStyle, type Preset, type StyleProperty, type ThemePresets } from '@cossackframework/cms';
import type { EditorBlock } from './editor';
import { icon } from './icons';

export type BlockTab = 'general' | 'style';

/** What the Style tab edits: the block's `style` and the layout extras. */
export interface StyleValues {
    style: BlockStyle;
    layout: { anchor?: string; className?: string; nosnippet?: boolean };
}

/** The style values of a block as editors hold it. */
export function styleValues(block: Pick<EditorBlock, 'style' | 'layout'>): StyleValues {
    return { style: { ...block.style }, layout: { anchor: block.layout?.anchor ?? '', className: block.layout?.className ?? '', nosnippet: block.layout?.nosnippet === true } };
}

/** A block with the Style tab's values applied, its hide list kept. */
export function withStyle<T extends Pick<EditorBlock, 'style' | 'layout'>>(block: T, values: StyleValues): T {
    const style = Object.fromEntries(Object.entries(values.style).filter(([, value]) => typeof value === 'string' && value)) as BlockStyle;
    const anchor = values.layout.anchor?.trim() ?? '';
    const className = values.layout.className?.trim() ?? '';
    const { anchor: _anchor, className: _className, nosnippet: _nosnippet, ...rest } = block.layout ?? {};
    return { ...block, style, layout: { ...rest, ...(anchor ? { anchor } : {}), ...(className ? { className } : {}), ...(values.layout.nosnippet ? { nosnippet: true } : {}) } };
}

const ALIGN_ICONS: Record<(typeof TEXT_ALIGNMENTS)[number], string> = { left: 'align-left', center: 'align-horizontal-center', right: 'align-right' };
const ALIGN_LABELS: Record<(typeof TEXT_ALIGNMENTS)[number], string> = { left: 'Align left', center: 'Align center', right: 'Align right' };

/** The two tabs over a block's settings. */
export function blockTabs(active: BlockTab, pick: (tab: BlockTab) => void, idPrefix: string): TemplateResult {
    const tab = (name: BlockTab, label: string) => html`<button type="button" role="tab" id=${`${idPrefix}-tab-${name}`} aria-selected=${active === name ? 'true' : 'false'} aria-controls=${`${idPrefix}-panel-${name}`}
        class=${`-mb-px border-b-2 bg-transparent px-3 py-1.5 text-xs font-medium cursor-pointer ${active === name ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        @click=${() => pick(name)}>${label}</button>`;
    return html`<div role="tablist" class="flex border-b border-border">${tab('general', __('General'))}${tab('style', __('Style'))}</div>`;
}

/**
 * The Style tab's controls for the properties the block supports. `change` receives the whole
 * values each time, so a screen keeps them as it keeps a form's values.
 */
export function styleControls(values: StyleValues, supports: readonly StyleProperty[], presets: Required<ThemePresets>, idPrefix: string, change: (values: StyleValues) => void): TemplateResult {
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
    return html`<div class="space-y-3" data-style-controls>
        ${!supports.length ? html`<p class="text-sm text-muted-foreground">${__('This block has no style settings.')}</p>` : null}
        ${has('background') ? colors('background', __('Background')) : null}
        ${has('text') ? colors('text', __('Text colour')) : null}
        ${short.length ? html`<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${short}</div>` : null}
        <details class="rounded-md border border-border">
            <summary class="cursor-pointer px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">${__('Advanced')}</summary>
            <div class="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
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

/** A row of swatches: none, then the palette. The chosen one is ringed. */
function colorControl(id: string, label: string, colors: readonly Preset[], value: string, set: (value: string) => void): TemplateResult {
    const swatch = (slug: string, name: string, color: string | null) => html`<button type="button" role="radio" aria-checked=${value === slug ? 'true' : 'false'} title=${name} aria-label=${name}
        class=${`h-7 w-7 rounded-full border cursor-pointer ${value === slug ? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-background' : 'border-border hover:border-foreground'}`}
        style=${color ? `background: ${color}` : 'background: linear-gradient(135deg, transparent 45%, var(--destructive) 45%, var(--destructive) 55%, transparent 55%)'}
        @click=${() => set(slug)}></button>`;
    return html`<div class="space-y-1">
        <span id=${id} class="block text-xs font-medium text-foreground">${label}</span>
        ${colors.length ? html`<div role="radiogroup" aria-labelledby=${id} class="flex flex-wrap items-center gap-1.5">
            ${swatch('', __('None'), null)}
            ${colors.map(preset => swatch(preset.slug, preset.name, preset.value))}
        </div>` : html`<p class="text-xs text-muted-foreground">${__('The theme has no colours. Add some under Appearance → Customize.')}</p>`}
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
