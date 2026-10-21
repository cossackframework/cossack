/**
 * The block tree editor shared by the entry editor and Appearance → Widgets: blocks as nested
 * sections, moved up, down, into the container above or out of their container, hidden per
 * container width, with an inserter at every level offering what fits there. Client-safe.
 * The screen renders each field's control, since it owns media choosing.
 */
import { Client, Component, Cossack } from '@cossackframework/core';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { blockId, BREAKPOINTS, insertBlock, removeBlock, shiftBlock, updateBlock, type BlockDeclaration, type BlockMove, type Breakpoint } from '@cossackframework/cms';
import { BlockInserter } from './block-inserter';
import { newBlock, type BlockOption, type EditorBlock, type EditorField } from './editor';
import type { MediaPreview } from './field-controls';

export type BlockTreeProps = {
    /** Page-unique prefix for control IDs. */
    id: string;
    blocks: EditorBlock[];
    /** Every block type, for labels and nesting rules. */
    options: BlockOption[];
    /** Types the field allows at the top level; empty for all. */
    allowed: string[];
    onChange(blocks: EditorBlock[]): void;
    /** A field's control; the screen's own, so media choosing lands in the right block. */
    control(field: EditorField, value: unknown, change: (value: unknown) => void, block: EditorBlock, id: string): TemplateResult | null;
    /** Fields under each block, or a summary with an Edit button that calls `onEdit`. */
    inline: boolean;
    onEdit?(id: string): void;
    previews?: Record<string, MediaPreview>;
    /** The field's validation message; shown under the block it names (`block <id>.<field> …`). */
    error?: string;
};

const BREAKPOINT_LABELS: { readonly [key in Breakpoint]: string } = { sm: 'Phones', md: 'Tablets', lg: 'Desktops' };

/** Types the inserter offers inside `parent` (null at the top level), by the types' nesting rules. */
export function offeredIn(options: readonly BlockOption[], parent: BlockOption | null, allowed: readonly string[] = []): BlockOption[] {
    return options.filter(option => option.name !== 'core/pattern' && (parent
        ? !!parent.children && (!parent.children.allowed.length || parent.children.allowed.includes(option.name)) && (!option.parent.length || option.parent.includes(parent.name))
        : !option.parent.length && (!allowed.length || allowed.includes(option.name))));
}

/** The options as declarations, for the CMS's tree moves. */
export function declarationsOf(options: readonly BlockOption[]): Map<string, BlockDeclaration> {
    return new Map(options.map(option => [option.name, {
        name: option.name, label: option.label, fields: {},
        ...(option.children ? { children: { ...(option.children.allowed.length ? { allowed: option.children.allowed } : {}), ...(option.children.max !== null ? { max: option.children.max } : {}) } } : {}),
        ...(option.parent.length ? { parent: option.parent } : {}),
    }]));
}

/** A block's first text, for summaries. */
export function blockSummary(block: EditorBlock, previews: Record<string, MediaPreview> = {}): string {
    const text = Object.values(block.data).find((value): value is string => typeof value === 'string' && value.trim() !== '' && !previews[value]);
    return text ? text.replace(/[*_#>`]/g, '').slice(0, 120) : '';
}

const BUTTON = 'rounded border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer disabled:cursor-default disabled:opacity-40';

@Component()
export class BlockTree extends Cossack {
    declare props: BlockTreeProps;

    private option(type: string): BlockOption | undefined {
        return this.props.options.find(option => option.name === type);
    }

    @Client()
    private add(parent: string | null, type: string) {
        const block = newBlock(type, this.props.options, blockId);
        if (block) this.props.onChange(insertBlock(this.props.blocks, parent, block));
    }

    @Client()
    private shift(id: string, move: BlockMove) {
        const next = shiftBlock(this.props.blocks, id, move, declarationsOf(this.props.options));
        if (next !== this.props.blocks) this.props.onChange([...next]);
    }

    @Client()
    private remove(id: string) {
        this.props.onChange(removeBlock(this.props.blocks, id));
    }

    @Client()
    private setValue(id: string, key: string, value: unknown) {
        this.props.onChange(updateBlock(this.props.blocks, id, block => ({ ...block, data: { ...block.data, [key]: value } })));
    }

    @Client()
    private toggleHide(id: string, breakpoint: Breakpoint) {
        this.props.onChange(updateBlock(this.props.blocks, id, block => {
            const hide = block.layout?.hide ?? [];
            const next = hide.includes(breakpoint) ? hide.filter(entry => entry !== breakpoint) : [...BREAKPOINTS].filter(entry => entry === breakpoint || hide.includes(entry));
            return { ...block, layout: { ...block.layout, hide: next } };
        }));
    }

    private section(block: EditorBlock, index: number, siblings: readonly EditorBlock[], parent: EditorBlock | null, depth: number): TemplateResult {
        const option = this.option(block.type);
        const label = option?.label ?? block.type;
        const hide = block.layout?.hide ?? [];
        const above = siblings[index - 1];
        const canGoIn = !!above && !!this.option(above.type)?.children && shiftBlock(this.props.blocks, block.id, 'in', declarationsOf(this.props.options)) !== this.props.blocks;
        const error = this.props.error && this.props.error.includes(`${block.id}.`) ? this.props.error : this.props.error?.includes(`block ${block.id} `) ? this.props.error : '';
        return html`<section class="rounded-lg border border-border bg-card" aria-label=${`${label} ${index + 1}`} data-block-tree-item=${block.id}>
            <header class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">${label}</span>
                <span class="flex flex-wrap items-center gap-1">
                    <span class="mr-1 inline-flex items-center gap-0.5" role="group" aria-label=${`${__('Hide')} ${label}`}>
                        ${BREAKPOINTS.map(breakpoint => html`<button type="button" class=${`${BUTTON} ${hide.includes(breakpoint) ? 'bg-muted text-foreground line-through' : ''}`}
                            aria-pressed=${hide.includes(breakpoint) ? 'true' : 'false'} title=${`${__('Hide on')} ${__(BREAKPOINT_LABELS[breakpoint]).toLowerCase()}`}
                            @click=${() => this.toggleHide(block.id, breakpoint)}>${breakpoint}</button>`)}
                    </span>
                    <button type="button" class=${BUTTON} title=${__('Move up')} aria-label=${`${__('Move up')} ${label}`} ?disabled=${index === 0} @click=${() => this.shift(block.id, 'up')}>↑</button>
                    <button type="button" class=${BUTTON} title=${__('Move down')} aria-label=${`${__('Move down')} ${label}`} ?disabled=${index === siblings.length - 1} @click=${() => this.shift(block.id, 'down')}>↓</button>
                    <button type="button" class=${BUTTON} title=${__('Move out of the container')} aria-label=${`${__('Move out')} ${label}`} ?disabled=${!parent} @click=${() => this.shift(block.id, 'out')}>←</button>
                    <button type="button" class=${BUTTON} title=${__('Move into the block above')} aria-label=${`${__('Move in')} ${label}`} ?disabled=${!canGoIn} @click=${() => this.shift(block.id, 'in')}>→</button>
                    ${!this.props.inline && option?.fields.length && this.props.onEdit ? html`<button type="button" class=${BUTTON} @click=${() => this.props.onEdit!(block.id)}>${__('Edit')}</button>` : null}
                    <button type="button" class=${BUTTON} title=${__('Remove block')} aria-label=${`${__('Remove')} ${label}`} @click=${() => this.remove(block.id)}>✕</button>
                </span>
            </header>
            <div class="space-y-3 p-3">
                ${!option ? html`<p class="text-sm text-muted-foreground">${__('This block type is no longer available. Its content stays until you remove it.')}</p>`
                : this.props.inline ? option.fields.map(field => {
                    const id = `${this.props.id}-${block.id}-${field.name}`;
                    const fieldError = this.props.error?.includes(`${block.id}.${field.name}`) ? this.props.error : '';
                    return html`<div class="space-y-1">
                        ${field.kind === 'boolean' ? null : html`<label for=${id} class="block text-xs font-medium text-foreground">${field.label}${field.required ? ' *' : ''}</label>`}
                        ${this.props.control(field, block.data[field.name], value => this.setValue(block.id, field.name, value), block, id)}
                        ${field.description ? html`<p class="text-xs text-muted-foreground">${field.description}</p>` : null}
                        ${fieldError ? html`<p role="alert" class="text-xs text-destructive">${fieldError}</p>` : null}
                    </div>`;
                }) : html`<p class="truncate text-sm text-foreground">${blockSummary(block, this.props.previews) || html`<span class="text-muted-foreground">${option.description || label}</span>`}</p>`}
                ${option?.children ? this.list(block.children ?? [], block, depth + 1) : null}
                ${error && !this.props.inline ? html`<p role="alert" class="text-xs text-destructive">${error}</p>` : null}
            </div>
        </section>`;
    }

    private list(blocks: readonly EditorBlock[], parent: EditorBlock | null, depth: number): TemplateResult {
        const container = parent ? this.option(parent.type) ?? null : null;
        const offered = offeredIn(this.props.options, container, this.props.allowed);
        const full = container?.children?.max !== null && container?.children?.max !== undefined && blocks.length >= container.children.max;
        return html`<div class=${depth ? 'space-y-3 border-l-2 border-border pl-3' : 'space-y-3'} data-block-tree-list=${parent?.id ?? ''}>
            ${blocks.length ? blocks.map((block, index) => this.section(block, index, blocks, parent, depth))
                : html`<p class="rounded-md border border-dashed border-border p-3 text-center text-sm text-muted-foreground">${parent ? __('Empty. Add a block below.') : __('No blocks yet. Add the first one below.')}</p>`}
            ${offered.length && !full ? component(BlockInserter, { id: `${this.props.id}-add-${parent?.id ?? 'top'}`, blocks: offered, compact: depth > 0, onPick: (type: string) => this.add(parent?.id ?? null, type) }) : null}
        </div>`;
    }

    render() {
        return this.list(this.props.blocks, null, 0);
    }
}
