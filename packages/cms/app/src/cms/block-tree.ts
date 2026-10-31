/**
 * The block tree editor shared by the entry editor and Appearance → Widgets: blocks as nested,
 * collapsible sections with their type's icon, dragged by a handle (the tree previews the drop
 * with a ghost of the block in its new place, opening the container it would land in; sideways
 * changes the container; the page scrolls near the window's edges), moved with the arrow keys
 * or buttons, hidden per device, with an inserter at every level offering what fits there.
 * Client-safe. The screen renders each field's control, since it owns media choosing.
 */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { AlertDialog, Badge, Icon } from '@cossackframework/ui';
import { blockId, BREAKPOINTS, FIELD_GROUP_LAYOUT, insertBlock, placeBlocks, removeBlock, shiftBlock, updateBlock, type BlockDeclaration, type BlockMove, type Breakpoint } from '@cossackframework/cms';
import { fieldName } from './builder';
import { BlockInserter } from './block-inserter';
import { reorderBlocks } from './block-rows';
import { blockErrorPath, blockErrorTarget, describeBlockError } from './block-errors';
import { newBlock, type BlockOption, type EditorBlock, type EditorField } from './editor';
import type { MediaPreview } from './field-controls';
import { blockIcon, blockIconColor, icon } from './icons';
import { iconButton } from './ui';

export type BlockTreeProps = {
    /** Page-unique prefix for control IDs. */
    id: string;
    blocks: EditorBlock[];
    /** Every block type, for labels and nesting rules. */
    options: BlockOption[];
    /** Types the field allows at the top level; empty for all. */
    allowed: string[];
    /** The field holds a form: input blocks are offered. */
    form?: boolean;
    /** The blocks are a field group: field blocks and layout blocks are offered, and every block opens in the panel. */
    fieldGroup?: boolean;
    onChange(blocks: EditorBlock[]): void;
    /** A field's control; the screen's own, so media choosing lands in the right block. */
    control(field: EditorField, value: unknown, change: (value: unknown) => void, block: EditorBlock, id: string): TemplateResult | null;
    /**
     * Opens a block in the screen's panel from its Edit button; the tree shows a summary. Rich
     * text fields are edited in place. In a form every block has the button, for its condition.
     */
    onEdit?(id: string): void;
    /** A collection template's lock: `insert` keeps the blocks (no adding or removing), `all` keeps their order too. */
    lock?: 'all' | 'insert';
    /** Offer saved patterns beside the top-level inserter. */
    onPatterns?(): void;
    previews?: Record<string, MediaPreview>;
    /**
     * The field's validation message. The tree opens to the block it names (`block <id>.<field> …`),
     * flashes it, scrolls it into view and shows the message under it with the block's name.
     */
    error?: string;
    /** Blocks that stay where they are: no dragging, moving or removing, and no move puts another block in their place. An editor layout's Edit tab, say. */
    pinned?: string[];
    /** Containers start open rather than collapsed, for a tree that is read as a whole, such as an editor layout. */
    expanded?: boolean;
    /** Offer the per-device hide toggles. Default true; an editor layout has no devices to hide on. */
    devices?: boolean;
    /** The summary beside a block's name, in place of its first text; undefined falls back to it. */
    summary?(block: EditorBlock, option: BlockOption | undefined): string | undefined;
};

/** Devices the hide toggles stand for, with their icons. */
export const BREAKPOINT_DEVICES: { readonly [key in Breakpoint]: { label: string; icon: string } } = {
    sm: { label: 'phones', icon: 'smartphone' }, md: { label: 'tablets', icon: 'tablet' }, lg: { label: 'desktops', icon: 'monitor' },
};

/** Types the inserter offers inside `parent` (null at the top level), by the types' nesting rules. A repeater (an input that holds blocks) goes one level deep. */
export function offeredIn(options: readonly BlockOption[], parent: BlockOption | null, allowed: readonly string[] = [], form = false, fieldGroup = false): BlockOption[] {
    return options.filter(option => option.name !== 'core/pattern' && (form || !option.input) && !(parent?.input && option.input && option.children) && (fieldGroup ? !!option.field || option.common || FIELD_GROUP_LAYOUT.has(option.name) : !option.field) && (parent
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

/** The border color of a nested list: deeper levels are stronger. */
export function levelBorder(depth: number): string {
    return `border-color: color-mix(in oklab, var(--primary) ${Math.min(15 + depth * 20, 95)}%, var(--border))`;
}

/** Field kinds short enough to share a row. */
const SHORT_KINDS = new Set(['enum', 'integer', 'number', 'boolean', 'datetime']);

const GRIP = html`<svg aria-hidden="true" viewBox="0 0 10 16" class="h-4 w-2.5 fill-current"><circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/></svg>`;

/** A drag in progress: the block and the tree as it would be if dropped now. */
interface Drag { id: string; blocks: EditorBlock[]; depth: number; moved: boolean }

/** A tree's arrangement, for telling whether a move changed anything. */
function treeShape(blocks: readonly EditorBlock[]): string {
    return placeBlocks(blocks).map(place => `${place.block._id}:${place.depth}`).join(' ');
}

/** How near the window's top or bottom edge a drag scrolls, in pixels; the nearer, the faster. */
const SCROLL_EDGE = 56;

/**
 * What a drag may scroll, nearest first: the ancestors that may scroll their content, then the
 * page. An ancestor that only hides sideways overflow computes as scrolling vertically too
 * without ever doing it, so the drag tries each in turn.
 */
function scrollersOf(element: HTMLElement): Element[] {
    const scrollers: Element[] = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const overflow = getComputedStyle(parent).overflowY;
        if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollHeight > parent.clientHeight) scrollers.push(parent);
    }
    const page = document.scrollingElement ?? document.documentElement;
    return scrollers.includes(page) ? scrollers : [...scrollers, page];
}

@Component()
export class BlockTree extends Cossack {
    declare props: BlockTreeProps;
    @ClientState() private collapsed: Record<string, boolean> = {};
    /** The block whose removal waits for confirmation. */
    @ClientState() private pendingRemove: string | null = null;
    @ClientState() private drag: Drag | null = null;
    private pointer: { id: number; x: number; y: number; depth: number } | null = null;
    /** The window's listeners while a drag is on. Lists render by position, so the handle that started a drag may show another block, or leave the page, as the preview moves. */
    private listeners: { move(event: PointerEvent): void; up(event: PointerEvent): void; cancel(): void; key(event: KeyboardEvent): void } | null = null;
    /** Where the pointer last was during a drag, and what the drag scrolls near the window's edges. */
    private last: { x: number; y: number } | null = null;
    private scrollers: Element[] = [];
    private scrollFrame = 0;
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

    /** Whether a container nobody toggled starts collapsed. */
    private get startCollapsed(): boolean {
        return this.props.expanded !== true;
    }

    /**
     * Containers are collapsed until opened (unless the tree starts `expanded`); a new one, one a
     * block just went into, one holding the block an error names, or one a dragged block would
     * land in, is open.
     */
    private isCollapsed(block: EditorBlock, option: BlockOption | undefined): boolean {
        return !!option?.children && (this.collapsed[block._id] ?? this.startCollapsed) && !this.errorPath.has(block._id) && !this.dropPath.has(block._id);
    }

    /** The containers of the dragged block in the drop preview; computed per render. */
    private dropPath = new Set<string>();

    /** The containers of a block, outermost first. */
    private ancestors(blocks: readonly EditorBlock[], id: string): string[] {
        const places = placeBlocks(blocks);
        const path: string[] = [];
        for (let parent = places.find(place => place.block._id === id)?.parent ?? null; parent; parent = places.find(place => place.block._id === parent)?.parent ?? null) path.unshift(parent);
        return path;
    }

    /**
     * Whether a moved tree keeps to what the tree allows beyond the types' nesting rules: a block
     * that comes to the top level is one of the `allowed` types, and the pinned blocks keep their
     * place, so nothing moves above an Edit tab or below a sidebar that stays last.
     */
    private fits(next: readonly EditorBlock[]): boolean {
        const pinned = this.props.pinned ?? [];
        const allowed = this.props.allowed;
        if (allowed.length && next.some(block => !allowed.includes(block.type) && !pinned.includes(block._id) && !this.props.blocks.some(entry => entry._id === block._id))) return false;
        if (!pinned.length) return true;
        const where = (blocks: readonly EditorBlock[]) => new Map(placeBlocks(blocks).filter(place => pinned.includes(place.block._id)).map(place => [place.block._id, `${place.parent}:${place.index}`]));
        const after = where(next);
        return [...where(this.props.blocks)].every(([id, place]) => after.get(id) === place);
    }

    /** The block the error names and its containers; computed per render. */
    private errorPath = new Set<string>();
    /** The error the tree last scrolled to, so it scrolls once per message. */
    private scrolledTo = '';

    /** Scroll to the block a new error names, once the render that opened its containers has committed. */
    @Client()
    private revealError() {
        const error = this.props.error;
        const target = blockErrorTarget(error);
        if (!target || !error || this.scrolledTo === error) return;
        this.scrolledTo = error;
        requestAnimationFrame(() => this.headers.get(target.id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    }

    @Client()
    private add(parent: string | null, type: string) {
        const block = newBlock(type, this.props.options, blockId);
        if (!block) return;
        this.collapsed = { ...this.collapsed, [block._id]: false };
        this.props.onChange(insertBlock(this.props.blocks, parent, block));
        // A new block opens in the panel at once when it has settings there, as its Edit button would.
        const option = this.props.options.find(entry => entry.name === type);
        if (option && this.props.onEdit && (option.fields.some(field => field.kind !== 'richtext') || this.props.form || this.props.fieldGroup)) {
            const edit = this.props.onEdit;
            requestAnimationFrame(() => {
                edit(block._id);
                // Once the sheet is open, the cursor goes to the block's first field.
                setTimeout(() => document.querySelector<HTMLElement>(':is(dialog[open], [role="dialog"]) [role="tabpanel"] :is(input:not([type="hidden"]):not([type="checkbox"]), textarea, select, [contenteditable="true"])')?.focus(), 150);
            });
        }
    }

    @Client()
    private shift(id: string, move: BlockMove, into?: string) {
        const next = shiftBlock(this.props.blocks, id, move, declarationsOf(this.props.options));
        if (next !== this.props.blocks && this.fits(next)) {
            if (into) this.collapsed = { ...this.collapsed, [into]: false };
            this.props.onChange([...next]);
            requestAnimationFrame(() => this.handles.get(id)?.focus());
        }
    }

    @Client()
    private remove(id: string) {
        this.pendingRemove = null;
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
    private toggleCollapsed(id: string) {
        // An untoggled container is as the tree starts it, so the first click turns that over.
        this.collapsed = { ...this.collapsed, [id]: !(this.collapsed[id] ?? this.startCollapsed) };
    }

    @Client()
    private collapseAll(collapsed: boolean) {
        this.collapsed = Object.fromEntries(this.containers().map(block => [block._id, collapsed]));
    }

    /** The blocks that can hold others, so can collapse. */
    private containers(): EditorBlock[] {
        return placeBlocks(this.props.blocks).map(place => place.block).filter(block => !!this.option(block.type)?.children);
    }

    // --- Dragging: the tree previews the drop; the block is a ghost in its new place ---------

    @Client()
    private startDrag(event: PointerEvent, id: string) {
        if (event.button !== 0 || this.props.lock === 'all' || this.props.pinned?.includes(id)) return;
        event.preventDefault();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        const depth = placeBlocks(this.props.blocks).find(place => place.block._id === id)?.depth ?? 0;
        this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, depth };
        this.drag = { id, blocks: this.props.blocks, depth, moved: false };
        this.listen();
        // After `listen`, which clears what an earlier drag left.
        this.last = { x: event.clientX, y: event.clientY };
        this.scrollers = scrollersOf(event.currentTarget as HTMLElement);
        this.autoScroll();
    }

    /** Follow the drag from the window, whichever element is under the pointer; Escape cancels it wherever the focus is. */
    @Client()
    private listen() {
        this.unlisten();
        const listeners = {
            move: (event: PointerEvent) => this.moveDrag(event), up: (event: PointerEvent) => this.endDrag(event), cancel: () => this.cancelDrag(),
            key: (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); this.cancelDrag(); } },
        };
        window.addEventListener('pointermove', listeners.move);
        window.addEventListener('pointerup', listeners.up);
        window.addEventListener('pointercancel', listeners.cancel);
        window.addEventListener('keydown', listeners.key);
        this.listeners = listeners;
    }

    @Client()
    private unlisten() {
        cancelAnimationFrame(this.scrollFrame);
        this.last = null;
        const listeners = this.listeners;
        if (!listeners) return;
        window.removeEventListener('pointermove', listeners.move);
        window.removeEventListener('pointerup', listeners.up);
        window.removeEventListener('pointercancel', listeners.cancel);
        window.removeEventListener('keydown', listeners.key);
        this.listeners = null;
    }

    /** While a drag is on, a pointer near the window's top or bottom scrolls the page, and the preview follows what comes under it. */
    @Client()
    private autoScroll() {
        cancelAnimationFrame(this.scrollFrame);
        const step = () => {
            const last = this.last;
            if (!this.drag || !last) return;
            const bottom = window.innerHeight - SCROLL_EDGE;
            const speed = Math.round(last.y < SCROLL_EDGE ? -(SCROLL_EDGE - last.y) / 3 : last.y > bottom ? (last.y - bottom) / 3 : 0);
            // The nearest that moves scrolls; the preview follows what comes under the pointer.
            const scrolled = speed !== 0 && this.scrollers.some(scroller => {
                const before = scroller.scrollTop;
                scroller.scrollTop = before + speed;
                return scroller.scrollTop !== before;
            });
            if (scrolled && this.drag.moved) this.dragTo(last.x, last.y);
            this.scrollFrame = requestAnimationFrame(step);
        };
        this.scrollFrame = requestAnimationFrame(step);
    }

    @Client()
    private moveDrag(event: PointerEvent) {
        if (!this.pointer || event.pointerId !== this.pointer.id) return;
        this.last = { x: event.clientX, y: event.clientY };
        this.dragTo(event.clientX, event.clientY);
    }

    /** The preview for the pointer at (x, y): the row under it decides the drop. */
    @Client()
    private dragTo(x: number, y: number) {
        const pointer = this.pointer;
        const drag = this.drag;
        if (!pointer || !drag) return;
        if (!drag.moved && Math.abs(y - pointer.y) < 4 && Math.abs(x - pointer.x) < 12) return;
        const original = placeBlocks(this.props.blocks);
        const from = original.findIndex(place => place.block._id === drag.id);
        const moving = new Set(placeBlocks([original[from]!.block]).map(place => place.block._id));
        // The rows that stay, in the order they show now; the one under the pointer decides the drop.
        const rest = placeBlocks(drag.blocks).filter(place => !moving.has(place.block._id));
        const depth = Math.min(Math.max(pointer.depth + Math.round((x - pointer.x) / 24), 0), 3);
        let to: number | null = null;
        for (const [index, place] of rest.entries()) {
            const rect = this.headers.get(place.block._id)?.getBoundingClientRect();
            if (!rect || y < rect.top || y > rect.bottom) continue;
            to = y < rect.top + rect.height / 2 ? index : index + 1;
            break;
        }
        if (to === null) { if (!drag.moved) this.drag = { ...drag, moved: true }; return; }
        const reordered = reorderBlocks(this.props.blocks, from, to, depth, declarationsOf(this.props.options));
        // A drop the tree does not allow previews as the block where it started.
        const next = this.fits(reordered) ? reordered : [...this.props.blocks];
        if (treeShape(next) !== treeShape(drag.blocks) || !drag.moved) this.drag = { ...drag, blocks: next, depth, moved: true };
    }

    @Client()
    private endDrag(event: PointerEvent) {
        const drag = this.drag;
        if (!this.pointer || event.pointerId !== this.pointer.id) return;
        this.unlisten();
        this.pointer = null;
        this.drag = null;
        if (drag?.moved && treeShape(drag.blocks) !== treeShape(this.props.blocks)) {
            // The container the block landed in stays open.
            const opened = this.ancestors(drag.blocks, drag.id);
            if (opened.length) this.collapsed = { ...this.collapsed, ...Object.fromEntries(opened.map(id => [id, false])) };
            this.props.onChange(drag.blocks);
            requestAnimationFrame(() => this.handles.get(drag.id)?.focus());
        }
    }

    @Client()
    private cancelDrag() {
        this.unlisten();
        this.pointer = null;
        this.drag = null;
    }

    @Client()
    private handleKey(event: KeyboardEvent, id: string) {
        if (event.key === 'Escape' && this.drag) { this.cancelDrag(); return; }
        if (this.props.lock === 'all' || this.props.pinned?.includes(id)) return;
        const move = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'out', ArrowRight: 'in' } as const)[event.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'];
        if (!move) return;
        event.preventDefault();
        this.shift(id, move);
    }

    // --- Rendering ----------------------------------------------------------------------------

    /** The block's fields: short ones share a row, long ones take the width. */
    private fields(block: EditorBlock, option: BlockOption, only?: readonly EditorField[]): TemplateResult {
        const runs: EditorField[][] = [];
        for (const field of only ?? option.fields) {
            const last = runs.at(-1);
            if (SHORT_KINDS.has(field.kind) && last && SHORT_KINDS.has(last[0]!.kind)) last.push(field); else runs.push([field]);
        }
        const control = (field: EditorField) => {
            const id = `${this.props.id}-${block._id}-${field.name}`;
            const fieldError = this.props.error?.includes(`${block._id}.${field.name}`) ? this.props.error : '';
            return html`<div class="min-w-0 space-y-1">
                ${field.kind === 'boolean' || field.kind === 'richtext' ? null : html`<label for=${id} class="block text-xs font-medium text-foreground">${field.label}${field.required ? ' *' : ''}</label>`}
                ${this.props.control(field, block.data[field.name], value => this.setValue(block._id, field.name, value), block, id)}
                ${field.description ? html`<p class="text-xs text-muted-foreground">${field.description}</p>` : null}
                ${fieldError ? html`<p role="alert" class="text-xs text-destructive">${fieldError}</p>` : null}
            </div>`;
        };
        return html`${runs.map(run => run.length > 1 || SHORT_KINDS.has(run[0]!.kind)
            ? html`<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${run.map(control)}</div>` : control(run[0]!))}`;
    }

    private section(block: EditorBlock, index: number, siblings: readonly EditorBlock[], parent: EditorBlock | null, depth: number): TemplateResult {
        const option = this.option(block.type);
        const label = option?.label ?? block.type;
        const hide = block.layout?.hide ?? [];
        const ghost = this.drag?.moved && this.drag.id === block._id;
        const collapsed = this.isCollapsed(block, option);
        const held = collapsed ? placeBlocks(block.children ?? []).length : 0;
        const above = siblings[index - 1];
        const pinned = this.props.pinned?.includes(block._id) === true;
        const locked = this.props.lock === 'all' || pinned;
        const canGoIn = !ghost && !locked && !!above && !!this.option(above.type)?.children && shiftBlock(this.props.blocks, block._id, 'in', declarationsOf(this.props.options)) !== this.props.blocks;
        // The message names this block (or one of its fields): shown here in words, and the block flashes.
        const target = blockErrorTarget(this.props.error);
        const error = target?.id === block._id ? describeBlockError(this.props.error!, this.props.blocks, this.props.options) : '';
        const summary = this.props.summary?.(block, option) ?? (option?.field ? (typeof block.data.description === 'string' ? block.data.description : '') : blockSummary(block, this.props.previews));
        const prefix = `${this.props.id}-${block._id}`;
        // Rich text is written in place, whichever way the block's other settings are edited; its
        // toolbar names it, so it has no label of its own above the block's header.
        const inlineFields = option?.fields.filter(field => field.kind === 'richtext') ?? [];
        const data = option?.category === 'data';
        return html`<section class=${`rounded-lg border bg-card ${ghost ? 'border-dashed border-primary bg-primary/5 opacity-50' : error ? 'cms-block-error border-destructive' : data ? 'border-dashed border-border' : 'border-border'}`} aria-label=${`${label} ${index + 1}`} data-block-tree-item=${block._id}>
            <header class="flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5" ref=${(element: Element) => { if (element) this.headers.set(block._id, element as HTMLElement); else this.headers.delete(block._id); }}>
                <button type="button" class=${`flex h-7 w-5 shrink-0 touch-none items-center justify-center rounded border-none bg-transparent text-muted-foreground ${locked ? 'cursor-default opacity-40' : 'cursor-grab hover:bg-muted active:cursor-grabbing'}`} data-handle
                    aria-label=${pinned ? `${label}. ${__('This block stays where it is.')}` : locked ? `${label}. ${__('The template keeps this order.')}` : `${__('Move')} ${label}. ${__('Drag, or use the arrow keys.')}`} ?disabled=${locked}
                    ref=${(element: Element) => { if (element) this.handles.set(block._id, element as HTMLElement); else this.handles.delete(block._id); }}
                    @pointerdown=${(event: PointerEvent) => this.startDrag(event, block._id)}
                    @keydown=${(event: KeyboardEvent) => this.handleKey(event, block._id)}>${GRIP}</button>
                ${option?.children ? html`<button type="button" class="inline-flex h-7 w-6 shrink-0 items-center justify-center rounded border-none bg-transparent text-muted-foreground hover:bg-muted cursor-pointer [&_svg]:size-4"
                    aria-expanded=${collapsed ? 'false' : 'true'} aria-label=${`${collapsed ? __('Expand') : __('Collapse')} ${label}`} @click=${() => this.toggleCollapsed(block._id)}>
                    ${component(Icon, { entry: icon(collapsed ? 'alt-arrow-right' : 'alt-arrow-down'), size: 16 })}</button>` : null}
                <span class=${`inline-flex shrink-0 [&_svg]:size-4 ${blockIconColor(option?.category)}`}>${component(Icon, { entry: blockIcon(option?.icon), size: 16 })}</span>
                <span class="min-w-0 flex-1 truncate text-sm">
                    <span class="font-medium text-foreground">${option?.field && typeof block.data.label === 'string' && block.data.label ? block.data.label : label}</span>
                    ${option?.field ? html` <code class="text-xs text-muted-foreground">${typeof block.data.name === 'string' && block.data.name ? block.data.name : fieldName(String(block.data.label ?? ''))}</code> ${component(Badge, { variant: 'outline' }, label)}` : null}
                    ${data ? html` ${component(Badge, { variant: 'outline' }, __('Data only'))}` : null}
                    ${block.when ? html` ${component(Badge, { variant: 'outline' }, block.when.action === 'hide' ? __('Hidden if…') : __('Shown if…'))}` : null}
                    ${summary ? html`<span class="ml-2 text-muted-foreground">${summary}</span>` : null}
                    ${collapsed ? html`<span class="ml-2 text-muted-foreground">${held} ${held === 1 ? __('block') : __('blocks')}</span>` : null}
                </span>
                <span class="flex flex-wrap items-center gap-1">
                    ${data || this.props.devices === false ? null : html`<span class="mr-1 inline-flex items-center gap-0.5" role="group" aria-label=${`${__('Hide')} ${label}`}>
                        ${BREAKPOINTS.map(breakpoint => {
                            const hidden = hide.includes(breakpoint);
                            const device = __(BREAKPOINT_DEVICES[breakpoint].label);
                            return iconButton(`${prefix}-hide-${breakpoint}`, BREAKPOINT_DEVICES[breakpoint].icon, hidden ? `${__('Hidden on')} ${device}` : `${__('Hide on')} ${device}`, () => this.toggleHide(block._id, breakpoint),
                                { pressed: hidden, class: hidden ? 'border-destructive/40 bg-destructive/10 text-destructive hover:text-destructive' : '' });
                        })}
                    </span>`}
                    ${iconButton(`${prefix}-up`, 'arrow-up', `${__('Move up')} ${label}`, () => this.shift(block._id, 'up'), { disabled: locked || index === 0 })}
                    ${iconButton(`${prefix}-down`, 'arrow-down', `${__('Move down')} ${label}`, () => this.shift(block._id, 'down'), { disabled: locked || index === siblings.length - 1 })}
                    ${iconButton(`${prefix}-out`, 'arrow-left', `${__('Move out')} ${label}`, () => this.shift(block._id, 'out'), { disabled: locked || !parent })}
                    ${iconButton(`${prefix}-in`, 'arrow-right', `${__('Move in')} ${label}`, () => this.shift(block._id, 'in', above?._id), { disabled: !canGoIn })}
                    ${option && this.props.onEdit && (option.fields.length > inlineFields.length || this.props.form || this.props.fieldGroup) ? iconButton(`${prefix}-edit`, 'pen', `${__('Edit')} ${label}`, () => this.props.onEdit!(block._id)) : null}
                    ${this.props.lock || pinned ? null : iconButton(`${prefix}-remove`, 'trash-bin-trash', `${__('Remove')} ${label}`, () => { this.pendingRemove = block._id; }, { danger: true })}
                </span>
            </header>
            ${collapsed || (option && !inlineFields.length && !option.children && !error) ? null : html`<div class="space-y-3 p-3">
                ${!option ? html`<p class="text-sm text-muted-foreground">${__('This block type is no longer available. Its content stays until you remove it.')}</p>`
                : inlineFields.length ? this.fields(block, option, inlineFields) : null}
                ${option?.children ? this.list(block.children ?? [], block, depth + 1) : null}
                ${error ? html`<p role="alert" class="text-xs text-destructive">${error}</p>` : null}
            </div>`}
        </section>`;
    }

    private list(blocks: readonly EditorBlock[], parent: EditorBlock | null, depth: number): TemplateResult {
        const container = parent ? this.option(parent.type) ?? null : null;
        const offered = offeredIn(this.props.options, container, this.props.allowed, this.props.form === true, this.props.fieldGroup === true);
        const full = container?.children?.max !== null && container?.children?.max !== undefined && blocks.length >= container.children.max;
        return html`<div class=${depth ? 'space-y-3 border-l-2 pl-3' : 'space-y-3'} style=${depth ? levelBorder(depth) : ''} data-block-tree-list=${parent?._id ?? ''}>
            ${blocks.length ? blocks.map((block, index) => this.section(block, index, blocks, parent, depth))
                : html`<p class="rounded-md border border-dashed border-border p-3 text-center text-sm text-muted-foreground">${parent ? __('Empty. Add a block below.') : __('No blocks yet. Add the first one below.')}</p>`}
            ${offered.length && !full && !this.props.lock ? html`<div class="flex flex-wrap items-center gap-2">
                ${component(BlockInserter, { id: `${this.props.id}-add-${parent?._id ?? 'top'}`, blocks: offered, compact: depth > 0, onPick: (type: string) => this.add(parent?._id ?? null, type) })}
                ${!parent && this.props.onPatterns ? html`<button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted cursor-pointer [&_svg]:size-4"
                    @click=${() => this.props.onPatterns!()}>${component(Icon, { entry: icon('widget-add'), size: 16 })}${__('Patterns')}</button>` : null}
            </div>` : null}
        </div>`;
    }

    render() {
        this.errorPath = blockErrorPath(this.props.error, this.props.blocks);
        this.dropPath = new Set(this.drag?.moved ? this.ancestors(this.drag.blocks, this.drag.id) : []);
        if (typeof window !== 'undefined') this.revealError();
        const places = placeBlocks(this.props.blocks);
        const containers = this.containers();
        const allCollapsed = containers.every(block => this.collapsed[block._id] ?? this.startCollapsed);
        const pending = this.pendingRemove ? places.find(place => place.block._id === this.pendingRemove) : undefined;
        const pendingLabel = pending ? this.option(pending.block.type)?.label ?? pending.block.type : '';
        const held = pending ? placeBlocks([pending.block]).length - 1 : 0;
        return html`<div class="space-y-2">
            ${containers.length ? html`<p class="flex justify-end text-xs"><button type="button" class="border-none bg-transparent text-muted-foreground hover:text-foreground cursor-pointer" @click=${() => this.collapseAll(!allCollapsed)}>${allCollapsed ? __('Expand all') : __('Collapse all')}</button></p>` : null}
            ${this.list(this.tree, null, 0)}
            ${component(AlertDialog, {
                id: `${this.props.id}-remove-dialog`, open: pending !== undefined, title: `${__('Remove')} ${pendingLabel}?`,
                description: held ? `${__('The block and the')} ${held} ${held === 1 ? __('block inside it are removed.') : __('blocks inside it are removed.')}` : __('The block and what it holds are removed from this entry.'),
                cancelLabel: __('Cancel'), actionLabel: __('Remove'), actionVariant: 'destructive',
                onAction: () => { if (this.pendingRemove) this.remove(this.pendingRemove); }, onOpenChange: () => { this.pendingRemove = null; },
            })}
        </div>`;
    }
}
