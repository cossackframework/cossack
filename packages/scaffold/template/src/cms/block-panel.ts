/**
 * The panel a block is edited in: a sheet at the side of the screen with the block's General
 * tab (its fields, rendered by the screen) and its Style tab, so the block tree stays compact.
 * Shared by the entry editor, Appearance → Widgets and the collection builder. Client-safe.
 */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Button, Icon, Sheet } from '@cossackframework/ui';
import type { ThemePresets } from '@cossackframework/cms';
import type { BlockOption } from './editor';
import { blockIcon, blockIconColor } from './icons';
import { blockTabs, styleControls, type BlockTab, type StyleValues } from './style-controls';

export interface BlockPanelProps {
    /** Page-unique prefix for control IDs. */
    id: string;
    open: boolean;
    option: BlockOption | null;
    tab: BlockTab;
    /** The General tab's content: the block's fields as the screen renders them. */
    general: TemplateResult;
    style: StyleValues;
    presets: Required<ThemePresets>;
    /** Without a Style tab, such as for blocks embedded in rich text. */
    styleTab?: boolean;
    applyLabel?: string;
    onTab(tab: BlockTab): void;
    onStyle(values: StyleValues): void;
    onApply(): void;
    onClose(): void;
}

export function blockPanel(props: BlockPanelProps): TemplateResult {
    const option = props.option;
    const withStyle = props.styleTab !== false && !!option && option.supports.length > 0 && option.category !== 'data';
    return component(Sheet, { id: `${props.id}-panel`, open: props.open && !!option, side: 'right', size: '30rem', 'aria-label': option?.label ?? __('Block'), onOpenChange: (open: boolean) => { if (!open) props.onClose(); } },
        option ? html`<form class="flex h-full flex-col" @submit=${(event: Event) => { event.preventDefault(); props.onApply(); }}>
            <header class="flex items-start gap-3 border-b border-border px-5 py-4">
                <span class=${`mt-0.5 inline-flex shrink-0 [&_svg]:size-5 ${blockIconColor(option.category)}`}>${component(Icon, { entry: blockIcon(option.icon), size: 20 })}</span>
                <div class="min-w-0 flex-1">
                    <h2 class="text-base font-semibold text-foreground">${option.label}</h2>
                    ${option.description ? html`<p class="text-xs text-muted-foreground">${option.description}</p>` : null}
                </div>
                <button type="button" class="inline-flex size-8 shrink-0 items-center justify-center rounded-md border-none bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer" aria-label=${__('Close')} @click=${() => props.onClose()}>✕</button>
            </header>
            ${withStyle ? html`<div class="px-5 pt-3">${blockTabs(props.tab, tab => props.onTab(tab), `${props.id}-panel`)}</div>` : null}
            <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4" role="tabpanel">
                ${withStyle && props.tab === 'style' ? styleControls(props.style, option.supports, props.presets, `${props.id}-panel-style`, values => props.onStyle(values))
                    : props.general}
            </div>
            <footer class="flex justify-end gap-2 border-t border-border px-5 py-3">
                ${component(Button, { type: 'button', variant: 'outline', '@click': () => props.onClose() }, __('Cancel'))}
                ${component(Button, { type: 'submit' }, props.applyLabel ?? __('Apply'))}
            </footer>
        </form>` : html``);
}
