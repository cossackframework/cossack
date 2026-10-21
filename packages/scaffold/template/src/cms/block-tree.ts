/**
 * The block tree editor shared by the entry editor and Appearance → Widgets: blocks as nested,
 * collapsible sections with their type's icon, dragged by a handle (the tree previews the drop
 * with a ghost of the block in its new place; sideways changes the container), moved with the
 * arrow keys or buttons, hidden per device, with an inserter at every level offering what fits
 * there. Client-safe. The screen renders each field's control, since it owns media choosing.
 */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Icon } from '@cossackframework/ui';
import { blockId, BREAKPOINTS, insertBlock, placeBlocks, removeBlock, shiftBlock, updateBlock, type BlockDeclaration, type BlockMove, type Breakpoint, type ThemePresets } from '@cossackframework/cms';
import { BlockInserter } from './block-inserter';
import { reorderBlocks } from './block-rows';
import { newBlock, type BlockOption, type EditorBlock, type EditorField } from './editor';
import type { MediaPreview } from './field-controls';
import { blockIcon, icon } from './icons';
import { blockTabs, styleControls, styleValues, withStyle, type BlockTab } from './style-controls';

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
    /** The theme's presets for the Style tab; without them the tab offers alignment and Advanced alone. */
    presets?: Required<ThemePresets>;
};

/** Devices the hide toggles stand for, with their icons. */
export const BREAKPOINT_DEVICES: { readonly [key in Breakpoint]: { label: string; icon: string } } = {
    sm: { label: 'phones', icon: 'smartphone' }, md: { label: 'tablets', icon: 'tablet' }, lg: { label: 'desktops', icon: 'monitor' },
};

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

/** The border colour of a nested list: deeper levels are stronger. */
export function levelBorder(depth: number): string {
    return `border-color: color-mix(in oklab, var(--primary) ${Math.min(15 + depth * 20, 95)}%, var(--border))`;
}

/** Field kinds short enough to share a row. */
const SHORT_KINDS = new Set(['enum', 'integer', 'number', 'boolean', 'datetime']);

const BUTTON = 'inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer disabled:cursor-default disabled:opacity-40 [&_svg]:size-4';
const GRIP = html`<svg aria-hidden="true" viewBox="0 0 10 16" class="h-4 w-2.5 fill-current"><circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/></svg>`;

/** A drag in progress: the block and the tree as it would be if dropped now. */
interface Drag { id: string; blocks: EditorBlock[]; depth: number; moved: boolean }

@Component()
export class BlockTree extends Cossack {
    declare props: BlockTreeProps;
    @ClientState() private collapsed: Record<string, boolean> = {};
    @ClientState() private tabs: Record<string, BlockTab> = {};
    @ClientState() private drag: Drag | null = null;
    private pointer: { id: number; x: number; y: number; depth: number } | null = null;
    /** Each block's header, measured while dragging. */
    private headers = new Map<string, HTMLElement>();
    private handles = new Map<string, HTMLElement>();

    private option(type: string): BlockOption | undefined {
        return this.props.options.find(option => option.name === type);
    }

    /** The tree shown: the drop preview while dragging. */
    private get tree(): EditorBlock[] {
        return this.drag?.blocks ?? this.props.blocks;
    }

    @Client()
    private add(parent: string | null, type: string) {
        const block = newBlock(type, this.props.options, blockId);
        if (block) this.props.onChange(insertBlock(this.props.blocks, parent, block));
    }

    @Client()
    private shift(id: string, move: BlockMove) {
        const next = shiftBlock(this.props.blocks, id, move, declarationsOf(this.props.options));
        if (next !== this.props.blocks) {
            this.props.onChange([...next]);
            requestAnimationFrame(() => this.handles.get(id)?.focus());
        }
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

    @Client()
    private showTab(id: string, tab: BlockTab) {
        this.tabs = { ...this.tabs, [id]: tab };
    }

    @Client()
    private toggleCollapsed(id: string) {
        this.collapsed = { ...this.collapsed, [id]: !this.collapsed[id] };
    }

    @Client()
    private collapseAll(collapsed: boolean) {
        this.collapsed = Object.fromEntries(placeBlocks(this.props.blocks).map(place => [place.block.id, collapsed]));
    }

    // --- Dragging: the tree previews the drop; the block is a ghost in its new place ---------

    @Client()
    private startDrag(event: PointerEvent, id: string) {
        if (event.button !== 0) return;
        event.preventDefault();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        const depth = placeBlocks(this.props.blocks).find(place => place.block.id === id)?.depth ?? 0;
        this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, depth };
        this.drag = { id, blocks: this.props.blocks, depth, moved: false };
    }

    @Client()
    private moveDrag(event: PointerEvent) {
        const pointer = this.pointer;
        const drag = this.drag;
        if (!pointer || !drag || event.pointerId !== pointer.id) return;
        if (!drag.moved && Math.abs(event.clientY - pointer.y) < 4 && Math.abs(event.clientX - pointer.x) < 12) return;
        const original = placeBlocks(this.props.blocks);
        const from = original.findIndex(place => place.block.id === drag.id);
        const moving = new Set(placeBlocks([original[from]!.block]).map(place => place.block.id));
        // The rows that stay, in the order they show now; the one under the pointer decides the drop.
        const rest = placeBlocks(drag.blocks).filter(place => !moving.has(place.block.id));
        const depth = Math.min(Math.max(pointer.depth + Math.round((event.clientX - pointer.x) / 24), 0), 3);
        let to: number | null = null;
        for (const [index, place] of rest.entries()) {
            const rect = this.headers.get(place.block.id)?.getBoundingClientRect();
            if (!rect || event.clientY < rect.top || event.clientY > rect.bottom) continue;
            to = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
            break;
        }
        if (to === null) { if (!drag.moved) this.drag = { ...drag, moved: true }; return; }
        const next = reorderBlocks(this.props.blocks, from, to, depth, declarationsOf(this.props.options));
        const shape = (blocks: readonly EditorBlock[]) => placeBlocks(blocks).map(place => `${place.block.id}:${place.depth}`).join(' ');
        if (shape(next) !== shape(drag.blocks) || !drag.moved) this.drag = { ...drag, blocks: next, depth, moved: true };
    }

    @Client()
    private endDrag(event: PointerEvent) {
        const drag = this.drag;
        if (!this.pointer || event.pointerId !== this.pointer.id) return;
        this.pointer = null;
        this.drag = null;
        if (drag?.moved && drag.blocks !== this.props.blocks) {
            this.props.onChange(drag.blocks);
            requestAnimationFrame(() => this.handles.get(drag.id)?.focus());
        }
    }

    @Client()
    private cancelDrag() {
        this.pointer = null;
        this.drag = null;
    }

    @Client()
    private handleKey(event: KeyboardEvent, id: string) {
        if (event.key === 'Escape' && this.drag) { this.cancelDrag(); return; }
        const move = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'out', ArrowRight: 'in' } as const)[event.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'];
        if (!move) return;
        event.preventDefault();
        this.shift(id, move);
    }

    // --- Rendering ----------------------------------------------------------------------------

    private iconButton(name: string, title: string, run: () => void, disabled = false, className = ''): TemplateResult {
        return html`<button type="button" class=${`${BUTTON} ${className}`} title=${title} aria-label=${title} ?disabled=${disabled} @click=${run}>${component(Icon, { entry: icon(name), size: 16 })}</button>`;
    }

    /** The block's fields: short ones share a row, long ones take the width. */
    private fields(block: EditorBlock, option: BlockOption): TemplateResult {
        const runs: EditorField[][] = [];
        for (const field of option.fields) {
            const last = runs.at(-1);
            if (SHORT_KINDS.has(field.kind) && last && SHORT_KINDS.has(last[0]!.kind)) last.push(field); else runs.push([field]);
        }
        const control = (field: EditorField) => {
            const id = `${this.props.id}-${block.id}-${field.name}`;
            const fieldError = this.props.error?.includes(`${block.id}.${field.name}`) ? this.props.error : '';
            return html`<div class="min-w-0 space-y-1">
                ${field.kind === 'boolean' ? null : html`<label for=${id} class="block text-xs font-medium text-foreground">${field.label}${field.required ? ' *' : ''}</label>`}
                ${this.props.control(field, block.data[field.name], value => this.setValue(block.id, field.name, value), block, id)}
                ${field.description ? html`<p class="text-xs text-muted-foreground">${field.description}</p>` : null}
                ${fieldError ? html`<p role="alert" class="text-xs text-destructive">${fieldError}</p>` : null}
            </div>`;
        };
        return html`${runs.map(run => run.length > 1 || SHORT_KINDS.has(run[0]!.kind)
            ? html`<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${run.map(control)}</div>` : control(run[0]!))}`;
    }

    /** The block's General and Style tabs. */
    private settings(block: EditorBlock, option: BlockOption): TemplateResult {
        const tab = this.tabs[block.id] ?? 'general';
        const prefix = `${this.props.id}-${block.id}`;
        return html`<div class="space-y-3">
            ${blockTabs(tab, next => this.showTab(block.id, next), prefix)}
            <div role="tabpanel" id=${`${prefix}-panel-${tab}`} aria-labelledby=${`${prefix}-tab-${tab}`}>
                ${tab === 'style' ? styleControls(styleValues(block), option.supports, this.props.presets ?? { colors: [], fontSizes: [], spacing: [] }, prefix,
                    values => this.props.onChange(updateBlock(this.props.blocks, block.id, entry => withStyle(entry, values))))
                : option.fields.length ? this.fields(block, option) : html`<p class="text-sm text-muted-foreground">${__('This block has no settings.')}</p>`}
            </div>
        </div>`;
    }

    private section(block: EditorBlock, index: number, siblings: readonly EditorBlock[], parent: EditorBlock | null, depth: number): TemplateResult {
        const option = this.option(block.type);
        const label = option?.label ?? block.type;
        const hide = block.layout?.hide ?? [];
        const ghost = this.drag?.moved && this.drag.id === block.id;
        const collapsed = this.collapsed[block.id] === true;
        const above = siblings[index - 1];
        const canGoIn = !ghost && !!above && !!this.option(above.type)?.children && shiftBlock(this.props.blocks, block.id, 'in', declarationsOf(this.props.options)) !== this.props.blocks;
        const error = this.props.error?.includes(`block ${block.id} `) ? this.props.error : '';
        const summary = blockSummary(block, this.props.previews);
        return html`<section class=${`rounded-lg border bg-card ${ghost ? 'border-dashed border-primary bg-primary/5 opacity-50' : 'border-border'}`} aria-label=${`${label} ${index + 1}`} data-block-tree-item=${block.id}>
            <header class="flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5" ref=${(element: Element) => { if (element) this.headers.set(block.id, element as HTMLElement); else this.headers.delete(block.id); }}>
                <button type="button" class="flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded border-none bg-transparent text-muted-foreground hover:bg-muted active:cursor-grabbing" data-handle
                    aria-label=${`${__('Move')} ${label}. ${__('Drag, or use the arrow keys.')}`}
                    ref=${(element: Element) => { if (element) this.handles.set(block.id, element as HTMLElement); else this.handles.delete(block.id); }}
                    @pointerdown=${(event: PointerEvent) => this.startDrag(event, block.id)} @pointermove=${(event: PointerEvent) => this.moveDrag(event)}
                    @pointerup=${(event: PointerEvent) => this.endDrag(event)} @pointercancel=${() => this.cancelDrag()} @lostpointercapture=${() => this.cancelDrag()}
                    @keydown=${(event: KeyboardEvent) => this.handleKey(event, block.id)}>${GRIP}</button>
                <button type="button" class="inline-flex h-7 w-6 shrink-0 items-center justify-center rounded border-none bg-transparent text-muted-foreground hover:bg-muted cursor-pointer [&_svg]:size-4"
                    aria-expanded=${collapsed ? 'false' : 'true'} aria-label=${`${collapsed ? __('Expand') : __('Collapse')} ${label}`} @click=${() => this.toggleCollapsed(block.id)}>
                    ${component(Icon, { entry: icon(collapsed ? 'alt-arrow-right' : 'alt-arrow-down'), size: 16 })}</button>
                <span class="inline-flex shrink-0 text-muted-foreground [&_svg]:size-4">${component(Icon, { entry: blockIcon(option?.icon), size: 16 })}</span>
                <span class="min-w-0 flex-1 truncate text-sm">
                    <span class="font-medium text-foreground">${label}</span>
                    ${summary ? html`<span class="ml-2 text-muted-foreground">${summary}</span>` : null}
                </span>
                <span class="flex flex-wrap items-center gap-1">
                    <span class="mr-1 inline-flex items-center gap-0.5" role="group" aria-label=${`${__('Hide')} ${label}`}>
                        ${BREAKPOINTS.map(breakpoint => {
                            const hidden = hide.includes(breakpoint);
                            const device = __(BREAKPOINT_DEVICES[breakpoint].label);
                            return html`<button type="button" class=${`${BUTTON} ${hidden ? 'border-destructive/40 bg-destructive/10 text-destructive hover:text-destructive' : ''}`}
                                aria-pressed=${hidden ? 'true' : 'false'} title=${hidden ? `${__('Hidden on')} ${device}` : `${__('Hide on')} ${device}`} aria-label=${`${__('Hide on')} ${device}`}
                                @click=${() => this.toggleHide(block.id, breakpoint)}>${component(Icon, { entry: icon(BREAKPOINT_DEVICES[breakpoint].icon), size: 16 })}</button>`;
                        })}
                    </span>
                    ${this.iconButton('arrow-up', `${__('Move up')} ${label}`, () => this.shift(block.id, 'up'), index === 0)}
                    ${this.iconButton('arrow-down', `${__('Move down')} ${label}`, () => this.shift(block.id, 'down'), index === siblings.length - 1)}
                    ${this.iconButton('arrow-left', `${__('Move out')} ${label}`, () => this.shift(block.id, 'out'), !parent)}
                    ${this.iconButton('arrow-right', `${__('Move in')} ${label}`, () => this.shift(block.id, 'in'), !canGoIn)}
                    ${!this.props.inline && option && this.props.onEdit ? html`<button type="button" class="h-7 rounded border border-border bg-background px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer" @click=${() => this.props.onEdit!(block.id)}>${__('Edit')}</button>` : null}
                    ${this.iconButton('trash-bin-trash', `${__('Remove')} ${label}`, () => this.remove(block.id), false, 'hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive')}
                </span>
            </header>
            ${collapsed ? null : html`<div class="space-y-3 p-3">
                ${!option ? html`<p class="text-sm text-muted-foreground">${__('This block type is no longer available. Its content stays until you remove it.')}</p>`
                : this.props.inline ? this.settings(block, option)
                : html`<p class="truncate text-sm text-muted-foreground">${summary || option.description || __('No settings.')}</p>`}
                ${option?.children ? this.list(block.children ?? [], block, depth + 1) : null}
                ${error && !this.props.inline ? html`<p role="alert" class="text-xs text-destructive">${error}</p>` : null}
            </div>`}
        </section>`;
    }

    private list(blocks: readonly EditorBlock[], parent: EditorBlock | null, depth: number): TemplateResult {
        const container = parent ? this.option(parent.type) ?? null : null;
        const offered = offeredIn(this.props.options, container, this.props.allowed);
        const full = container?.children?.max !== null && container?.children?.max !== undefined && blocks.length >= container.children.max;
        return html`<div class=${depth ? 'space-y-3 border-l-2 pl-3' : 'space-y-3'} style=${depth ? levelBorder(depth) : ''} data-block-tree-list=${parent?.id ?? ''}>
            ${blocks.length ? blocks.map((block, index) => this.section(block, index, blocks, parent, depth))
                : html`<p class="rounded-md border border-dashed border-border p-3 text-center text-sm text-muted-foreground">${parent ? __('Empty. Add a block below.') : __('No blocks yet. Add the first one below.')}</p>`}
            ${offered.length && !full ? component(BlockInserter, { id: `${this.props.id}-add-${parent?.id ?? 'top'}`, blocks: offered, compact: depth > 0, onPick: (type: string) => this.add(parent?.id ?? null, type) }) : null}
        </div>`;
    }

    render() {
        const places = placeBlocks(this.props.blocks);
        const allCollapsed = places.length > 0 && places.every(place => this.collapsed[place.block.id]);
        return html`<div class="space-y-2">
            ${places.length > 1 ? html`<p class="flex justify-end text-xs"><button type="button" class="border-none bg-transparent text-muted-foreground hover:text-foreground cursor-pointer" @click=${() => this.collapseAll(!allCollapsed)}>${allCollapsed ? __('Expand all') : __('Collapse all')}</button></p>` : null}
            ${this.list(this.tree, null, 0)}
        </div>`;
    }
}
