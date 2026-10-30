/**
 * The editor on the public site, loaded only in edit mode. Click a block to edit its fields
 * in a popover; click the body to edit it as one document in the rich text editor. The Blocks
 * panel shows the tree: drag a block, or use the arrow keys, to move it among its siblings
 * or into and out of containers; the Entry panel edits the title, slug, terms and other
 * fields. The device toggle narrows the content root. Changes stay in the page's draft until saved.
 */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Button, Checkbox, Icon } from '@cossackframework/ui';
import { blockId, BREAKPOINTS, findBlock, insertBlock, placeBlocks, removeBlock, shiftBlock, updateBlock, type BlockMove, type BlockPlace, type Breakpoint, type EmbeddedBlock, type RichTextDoc } from '@cossackframework/cms';
import { blockDefaults, controlValue, editorInput, newBlock, type BlockOption, type EditorValues } from './editor';
import { BREAKPOINT_DEVICES, declarationsOf, offeredIn } from './block-tree';
import { icon } from './icons';
import { blockFields, fieldControl, type MediaHooks, type MediaPreview } from './field-controls';
import { blockTabs, styleControls, styleValues, withStyle, type BlockTab, type StyleValues } from './style-controls';
import { mediaChooser, uploadMedia, withFile } from './media-chooser';
import { RichTextField, richTextEditors } from './rich-text-field';
import { BlockInserter } from './block-inserter';
import { reorderBlocks, type DraftBlock, type SiteEditorProps } from './site-editor';
import { CONTROL } from './ui';

const BODY_EDITOR = 'site-editor-body';
/** The removal buttons' icon; a fresh template each time, as the renderer keys templates by instance. */
const trash = () => html`<span class="inline-flex [&_svg]:size-3.5">${component(Icon, { entry: icon('trash-bin-trash'), size: 14 })}</span>`;
const PANEL = 'fixed z-50 flex flex-col overflow-hidden border border-border bg-background text-foreground shadow-2xl';
const STYLE = `
[data-cms-edit] > * { cursor: pointer; }
[data-cms-edit]:hover > * { outline: 2px dashed color-mix(in oklab, var(--ring, #3b82f6) 70%, transparent); outline-offset: 4px; }
[data-cms-edit][data-cms-selected] > * { outline: 2px solid var(--ring, #3b82f6); outline-offset: 4px; }
`;

/** A block's form: in a popover by the block, or in the Blocks panel when the theme does not show it. */
interface BlockForm { id: string; values: Record<string, unknown>; style: StyleValues; tab: BlockTab; errors: Record<string, string>; top: number; left: number; docked: boolean }
/** A block embedded in the body, edited from the rich text editor. */
interface EmbeddedForm { id: string; type: string; values: Record<string, unknown>; errors: Record<string, string> }
type ChooserTarget = { kind: 'block' | 'embedded' | 'entry'; field: string } | { kind: 'richtext'; /** The editor to insert into; the body's by default. */ editor?: string };
interface Drag { from: number; to: number; y: number; depth: number; moved: boolean }
type Device = 'desktop' | 'tablet' | 'phone';
const DEVICE_LABELS: { readonly [key in Device]: string } = { desktop: 'Desktop', tablet: 'Tablet', phone: 'Phone' };

@Component()
export class SiteEditor extends Cossack {
    declare props: SiteEditorProps;
    @ClientState() private form: BlockForm | null = null;
    @ClientState() private embedded: EmbeddedForm | null = null;
    @ClientState() private panel: 'entry' | 'blocks' | 'body' | null = null;
    @ClientState() private drag: Drag | null = null;
    @ClientState() private announcement = '';
    @ClientState() private device: Device = 'desktop';
    private chooserTarget: ChooserTarget | null = null;
    private root?: HTMLElement;
    private list?: HTMLElement;
    private rows = new Map<string, HTMLElement>();
    private handles = new Map<string, HTMLElement>();
    private pointer: { id: number; x: number; y: number; tops: number[]; bottoms: number[] } | null = null;
    private style?: HTMLStyleElement;
    private observer?: MutationObserver;

    private readonly onDocumentClick = (event: MouseEvent) => {
        const target = event.target as Element | null;
        if (!target || this.root?.contains(target) || target.closest('[role="dialog"]')) return;
        // The nearest block of this page: blocks rendered from elsewhere, such as a form's inputs, are
        // marked too, so clicking one selects the block that shows them (the Form block).
        let marker = target.closest('[data-cms-edit]');
        while (marker && marker.getAttribute('data-cms-edit') === 'block' && !findBlock(this.blocks(), marker.getAttribute('data-block-id') ?? '')) marker = marker.parentElement?.closest('[data-cms-edit]') ?? null;
        if (!marker) return;
        // Links and buttons inside blocks do not navigate while editing.
        event.preventDefault();
        event.stopPropagation();
        if (marker.getAttribute('data-cms-edit') === 'body') this.openPanel('body');
        else this.select(marker.getAttribute('data-block-id') ?? '', marker);
    };

    private readonly onKey = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        if (this.form) {
            // Escape in a nested block's form selects its container.
            const parent = this.places().find(place => place.block._id === this.form!.id)?.parent ?? null;
            if (parent) this.edit(parent); else this.form = null;
        } else if (this.embedded) this.embedded = null;
        else if (this.panel) this.panel = null;
    };

    private readonly onLeave = (event: BeforeUnloadEvent) => {
        if (this.props.draft.changed) event.preventDefault();
    };

    onMount() {
        this.style = document.createElement('style');
        this.style.textContent = STYLE;
        document.head.append(this.style);
        document.addEventListener('click', this.onDocumentClick, true);
        document.addEventListener('keydown', this.onKey);
        window.addEventListener('beforeunload', this.onLeave);
        this.observer = new MutationObserver(() => this.syncSelection());
        this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-block-id'] });
    }

    onCleanup() {
        this.observer?.disconnect();
        this.style?.remove();
        document.removeEventListener('click', this.onDocumentClick, true);
        document.removeEventListener('keydown', this.onKey);
        window.removeEventListener('beforeunload', this.onLeave);
        for (const marker of document.querySelectorAll('[data-cms-selected]')) marker.removeAttribute('data-cms-selected');
        delete document.documentElement.dataset.cmsDevice;
    }

    /**
     * Mark the selected block on the page. The page re-renders blocks after each change, so
     * a mutation observer (set up in onMount) marks it again; `updated` is not a lifecycle the
     * client bundle keeps.
     */
    @Client()
    private syncSelection() {
        for (const marker of document.querySelectorAll('[data-cms-selected]')) if (marker.getAttribute('data-block-id') !== this.form?.id) marker.removeAttribute('data-cms-selected');
        if (this.form) document.querySelector(`[data-cms-edit="block"][data-block-id="${CSS.escape(this.form.id)}"]`)?.setAttribute('data-cms-selected', '');
    }

    /**
     * Select a block added in the panel once the draft holds it and the page shows it: the
     * draft's new values and the page's preview of them arrive after this component rendered.
     */
    private selectWhenShown(id: string, tries = 40) {
        setTimeout(() => {
            const marker = document.querySelector(`[data-cms-edit="block"][data-block-id="${CSS.escape(id)}"]`);
            if ((!findBlock(this.blocks(), id) || !marker) && tries > 0) { this.selectWhenShown(id, tries - 1); return; }
            if (findBlock(this.blocks(), id)) this.select(id, marker);
        }, 50);
    }

    // --- Draft ---------------------------------------------------------------------

    private get values(): EditorValues { return this.props.draft.values; }

    private blocks(): DraftBlock[] {
        const field = this.props.draft.blocksField;
        return field ? (this.values[field] as DraftBlock[] | undefined) ?? [] : [];
    }

    /** Every block of the tree in document order, with its depth, container and position. */
    private places(): BlockPlace<DraftBlock>[] {
        return placeBlocks(this.blocks());
    }

    private option(type: string): BlockOption | undefined {
        return this.props.draft.view.blocks.find(block => block.name === type);
    }

    /** The block types the field allows at the top level. */
    private allowed(): string[] {
        const field = this.props.draft.view.fields.find(entry => entry.name === this.props.draft.blocksField);
        return field?.blocks ?? [];
    }

    @Client()
    private setBlocks(blocks: DraftBlock[], message = '') {
        const field = this.props.draft.blocksField;
        if (!field) return;
        this.props.onChange({ ...this.values, [field]: blocks }, true);
        if (message) this.announcement = message;
    }

    @Client()
    private setValue(name: string, value: unknown, preview = false) {
        this.props.onChange({ ...this.values, [name]: value }, preview);
    }

    private label(block: DraftBlock): string {
        return this.option(block.type)?.label ?? block.type;
    }

    private summary(block: DraftBlock): string {
        const text = Object.values(block.data).find((value): value is string => typeof value === 'string' && value.trim() !== '' && !this.props.draft.previews[value]);
        return text ? text.replace(/[*_#>`]/g, '').slice(0, 80) : '';
    }

    // --- Blocks ----------------------------------------------------------------------

    @Client()
    private select(id: string, marker: Element | null) {
        const block = findBlock(this.blocks(), id);
        const option = block ? this.option(block.type) : undefined;
        if (!block || !option) return;
        const rects = marker ? [...marker.children].map(child => child.getBoundingClientRect()).filter(rect => rect.width || rect.height) : [];
        const width = Math.min(448, window.innerWidth - 16);
        const bottom = rects.length ? Math.max(...rects.map(rect => rect.bottom)) : 0;
        const left = rects.length ? Math.min(...rects.map(rect => rect.left)) : 0;
        this.form = {
            id, errors: {}, docked: !rects.length, tab: this.form?.tab ?? 'general', style: styleValues(block),
            values: Object.fromEntries(option.fields.map(field => [field.name, block.data[field.name] ?? controlValue(field, field.defaultValue)])),
            top: Math.min(Math.max(bottom + 8, 8), Math.max(window.innerHeight - 320, 8)), left: Math.min(Math.max(left, 8), window.innerWidth - width - 8),
        };
        if (!rects.length) this.panel = 'blocks';
    }

    @Client()
    private setFormValue(name: string, value: unknown) {
        if (this.form) this.form = { ...this.form, values: { ...this.form.values, [name]: value }, errors: { ...this.form.errors, [name]: '' } };
    }

    @Client()
    private setFormStyle(style: StyleValues) {
        if (this.form) this.form = { ...this.form, style };
    }

    @Client()
    private showFormTab(tab: BlockTab) {
        if (this.form) this.form = { ...this.form, tab };
    }

    @Client()
    private apply(event: Event) {
        event.preventDefault();
        const form = this.form;
        const block = form ? findBlock(this.blocks(), form.id) : undefined;
        const option = block ? this.option(block.type) : undefined;
        if (!form || !block || !option) return;
        const errors = this.check(option, form.values);
        if (Object.keys(errors).length) { this.form = { ...form, errors }; return; }
        // Blocks keep control values, as the dashboard editor does; saving converts them.
        this.setBlocks(updateBlock(this.blocks(), form.id, entry => withStyle({ ...entry, data: { ...form.values } }, form.style)));
        this.form = null;
    }

    /** Field errors of a block form, required fields included. */
    private check(option: BlockOption, values: Record<string, unknown>): Record<string, string> {
        const { input, errors } = editorInput(option.fields, values);
        for (const field of option.fields) if (field.required && (input[field.name] === undefined || input[field.name] === '' || input[field.name] === null)) errors[field.name] ??= __('is required.');
        return errors;
    }

    /** Add a block at the end of the field, or inside a container. */
    @Client()
    private add(type: string, parent: string | null = null) {
        const option = this.option(type);
        const block = newBlock(type, this.props.draft.view.blocks, blockId);
        if (!option || !block) return;
        this.setBlocks(insertBlock(this.blocks(), parent, block), `${option.label} ${__('added.')}`);
        this.selectWhenShown(block._id);
    }

    /** Where a block sits after a move, for the announcement. */
    private position(blocks: readonly DraftBlock[], id: string): string {
        const place = placeBlocks(blocks).find(entry => entry.block._id === id);
        if (!place) return '';
        const siblings = place.parent ? findBlock(blocks, place.parent)?.children ?? [] : blocks;
        const container = place.parent ? findBlock(blocks, place.parent) : undefined;
        return `${__('block')} ${place.index + 1} ${__('of')} ${siblings.length}${container ? ` ${__('in')} ${this.label(container)}` : ''}`;
    }

    @Client()
    private shift(id: string, move: BlockMove) {
        const blocks = this.blocks();
        const block = findBlock(blocks, id);
        const next = shiftBlock(blocks, id, move, declarationsOf(this.props.draft.view.blocks));
        if (!block || next === blocks) return;
        this.setBlocks([...next], `${this.label(block)}: ${this.position(next, id)}`);
        requestAnimationFrame(() => this.handles.get(block._id)?.focus());
    }

    @Client()
    private toggleHide(id: string, breakpoint: Breakpoint) {
        const block = findBlock(this.blocks(), id);
        if (!block) return;
        const hide = block.layout?.hide ?? [];
        const next = hide.includes(breakpoint) ? hide.filter(entry => entry !== breakpoint) : [...BREAKPOINTS].filter(entry => entry === breakpoint || hide.includes(entry));
        this.setBlocks(updateBlock(this.blocks(), id, entry => ({ ...entry, layout: { ...entry.layout, hide: next } })),
            `${this.label(block)}: ${next.length ? `${__('hidden on')} ${next.map(entry => __(BREAKPOINT_DEVICES[entry].label)).join(', ')}` : __('shown everywhere')}`);
    }

    @Client()
    private remove(id: string) {
        const block = findBlock(this.blocks(), id);
        if (!block) return;
        if (this.form?.id === id) this.form = null;
        this.setBlocks(removeBlock(this.blocks(), id), `${this.label(block)} ${__('removed.')}`);
    }

    /** Narrow the content root to a device's width; the layout blocks respond to it. */
    @Client()
    private setDevice(device: Device) {
        this.device = device;
        if (device === 'desktop') delete document.documentElement.dataset.cmsDevice;
        else document.documentElement.dataset.cmsDevice = device;
    }

    @Client()
    private edit(id: string) {
        const marker = document.querySelector(`[data-cms-edit="block"][data-block-id="${CSS.escape(id)}"]`);
        if (marker) marker.firstElementChild?.scrollIntoView({ block: 'center' });
        requestAnimationFrame(() => this.select(id, marker));
    }

    // --- Dragging, as the menu editor does: rows with depths; sideways changes the depth ---

    @Client()
    private startDrag(event: PointerEvent, index: number) {
        if (event.button !== 0 || !this.list) return;
        event.preventDefault();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        const top = this.list.getBoundingClientRect().top;
        const places = this.places();
        const rects = places.map(place => this.rows.get(place.block._id)?.getBoundingClientRect());
        this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, tops: rects.map(rect => (rect?.top ?? 0) - top), bottoms: rects.map(rect => (rect?.bottom ?? 0) - top) };
        this.drag = { from: index, to: index, y: 0, depth: places[index]?.depth ?? 0, moved: false };
    }

    @Client()
    private moveDrag(event: PointerEvent) {
        const pointer = this.pointer;
        const drag = this.drag;
        if (!pointer || !drag || event.pointerId !== pointer.id || !this.list) return;
        if (!drag.moved && Math.abs(event.clientY - pointer.y) < 4 && Math.abs(event.clientX - pointer.x) < 12) return;
        const y = event.clientY - this.list.getBoundingClientRect().top;
        const places = this.places();
        // The subtree moves with its root: rows inside it are not drop targets.
        const size = placeBlocks([places[drag.from]!.block]).length;
        const rest = places.map((_, index) => index).filter(index => index < drag.from || index >= drag.from + size);
        let to = 0;
        while (to < rest.length && (pointer.tops[rest[to]!]! + pointer.bottoms[rest[to]!]!) / 2 < y) to++;
        const line = to < rest.length ? pointer.tops[rest[to]!]! : pointer.bottoms[rest.at(-1) ?? 0] ?? 0;
        const depth = Math.min(Math.max((places[drag.from]?.depth ?? 0) + Math.round((event.clientX - pointer.x) / 24), 0), 3);
        if (drag.to !== to || drag.depth !== depth || !drag.moved) this.drag = { ...drag, to, depth, y: line - 2, moved: true };
    }

    @Client()
    private endDrag(event: PointerEvent) {
        const drag = this.drag;
        if (!this.pointer || event.pointerId !== this.pointer.id) return;
        this.pointer = null;
        this.drag = null;
        if (!drag?.moved) return;
        const blocks = this.blocks();
        const block = this.places()[drag.from]?.block;
        if (!block) return;
        const next = reorderBlocks(blocks, drag.from, drag.to, drag.depth, declarationsOf(this.props.draft.view.blocks));
        if (placeBlocks(next).every((place, position) => place.block._id === blocks[position]?._id && place.depth === this.places()[position]?.depth)) return;
        this.setBlocks(next, `${this.label(block)}: ${this.position(next, block._id)}`);
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

    // --- Body ------------------------------------------------------------------------------

    @Client()
    private openPanel(panel: 'entry' | 'blocks' | 'body') {
        this.form = null;
        this.panel = this.panel === panel ? null : panel;
    }

    @Client()
    private closeBody() {
        this.panel = null;
        this.embedded = null;
        // Render the page from the edited body.
        this.props.onChange(this.values, true);
    }

    @Client()
    private insertEmbedded(type: string) {
        const option = this.option(type);
        const editor = richTextEditors.get(BODY_EDITOR);
        if (!option || !editor) return;
        const values = blockDefaults(option);
        const block: EmbeddedBlock = { _id: blockId(), type, data: editorInput(option.fields, values).input };
        editor.insertBlock(block);
        if (option.fields.length) this.embedded = { id: block._id, type, values, errors: {} };
    }

    @Client()
    private editEmbedded(block: EmbeddedBlock) {
        const option = this.option(block.type);
        if (!option) return;
        this.embedded = { id: block._id, type: block.type, errors: {}, values: Object.fromEntries(option.fields.map(field => [field.name, controlValue(field, block.data[field.name] ?? field.defaultValue)])) };
    }

    @Client()
    private setEmbeddedValue(name: string, value: unknown) {
        if (this.embedded) this.embedded = { ...this.embedded, values: { ...this.embedded.values, [name]: value }, errors: { ...this.embedded.errors, [name]: '' } };
    }

    @Client()
    private applyEmbedded(event: Event) {
        event.preventDefault();
        const form = this.embedded;
        const option = form ? this.option(form.type) : undefined;
        if (!form || !option) return;
        const errors = this.check(option, form.values);
        if (Object.keys(errors).length) { this.embedded = { ...form, errors }; return; }
        richTextEditors.get(BODY_EDITOR)?.updateBlock(form.id, editorInput(option.fields, form.values).input);
        this.embedded = null;
    }

    // --- Media -----------------------------------------------------------------------------

    @Client()
    private openChooser(target: ChooserTarget, multiple: boolean) {
        this.chooserTarget = target;
        this.props.onChooser({ ...this.props.draft.chooser, open: true, field: 'field' in target ? target.field : '', multiple });
        this.props.onSearchMedia(this.props.draft.chooser.search);
    }

    private media(target: ChooserTarget): MediaHooks {
        return { previews: this.props.draft.previews, choose: multiple => this.openChooser(target, multiple) };
    }

    @Client()
    private choose(file: MediaPreview) {
        const target = this.chooserTarget;
        const chooser = this.props.draft.chooser;
        if (!target) return;
        this.props.onPreviews({ ...this.props.draft.previews, [file.id]: file });
        if (target.kind === 'richtext') richTextEditors.get(target.editor ?? BODY_EDITOR)?.insertImage({ src: file.url, alt: file.alt || file.title, mediaId: file.id });
        else if (target.kind === 'block' && this.form) this.setFormValue(target.field, withFile(this.form.values[target.field], file.id, chooser.multiple));
        else if (target.kind === 'embedded' && this.embedded) this.setEmbeddedValue(target.field, withFile(this.embedded.values[target.field], file.id, chooser.multiple));
        else if (target.kind === 'entry') this.setValue(target.field, withFile(this.values[target.field], file.id, chooser.multiple));
        if (!chooser.multiple) this.props.onChooser({ ...chooser, open: false });
    }

    @Client()
    private async upload(event: Event) {
        const { files, error } = await uploadMedia(event.currentTarget as HTMLInputElement);
        if (error) this.announcement = error;
        for (const file of files) this.choose(file);
        this.props.onSearchMedia('');
    }

    // --- Rendering -------------------------------------------------------------------------

    private formCard(): TemplateResult | null {
        const form = this.form;
        const block = form ? findBlock(this.blocks(), form.id) : undefined;
        const option = block ? this.option(block.type) : undefined;
        if (!form || !block || !option) return null;
        const place = this.places().find(entry => entry.block._id === block._id)!;
        const siblings = place.parent ? findBlock(this.blocks(), place.parent)?.children ?? [] : this.blocks();
        const hide = block.layout?.hide ?? [];
        const style = form.docked ? '' : `top: ${form.top}px; left: ${form.left}px; width: min(28rem, calc(100vw - 1rem)); max-height: min(32rem, calc(100vh - ${form.top}px - 5rem))`;
        return html`<form role="dialog" aria-label=${`${__('Edit')} ${option.label}`} data-site-editor-form
            class=${form.docked ? 'space-y-4 rounded-md border border-border bg-card p-3' : `${PANEL} rounded-lg`} style=${style} @submit=${(event: Event) => this.apply(event)}>
            <div class=${form.docked ? 'space-y-4' : 'space-y-4 overflow-y-auto p-4'}>
                <div class="flex items-center justify-between gap-2">
                    <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">${option.label}</h2>
                    <span class="flex flex-wrap gap-1">
                        ${this.iconButton('↑', __('Move up'), () => this.shift(block._id, 'up'), place.index === 0)}
                        ${this.iconButton('↓', __('Move down'), () => this.shift(block._id, 'down'), place.index === siblings.length - 1)}
                        ${this.iconButton('←', __('Move out of the container'), () => this.shift(block._id, 'out'), !place.parent)}
                        ${this.iconButton('→', __('Move into the block above'), () => this.shift(block._id, 'in'), !this.canGoIn(block._id))}
                        ${this.iconButton(trash(), `${__('Remove')} ${option.label}`, () => this.remove(block._id))}
                    </span>
                </div>
                <div class="flex flex-wrap items-center gap-1 text-xs text-muted-foreground" role="group" aria-label=${__('Hide on')}>
                    <span>${__('Hide on')}</span>
                    ${BREAKPOINTS.map(breakpoint => {
                        const hidden = hide.includes(breakpoint);
                        const device = __(BREAKPOINT_DEVICES[breakpoint].label);
                        return html`<button type="button" aria-pressed=${hidden ? 'true' : 'false'} data-hide-toggle=${breakpoint} aria-label=${`${__('Hide on')} ${device}`} title=${hidden ? `${__('Hidden on')} ${device}` : `${__('Hide on')} ${device}`}
                            class=${`inline-flex h-7 w-7 items-center justify-center rounded border cursor-pointer [&_svg]:size-4 ${hidden ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border bg-background hover:bg-muted'}`}
                            @click=${() => this.toggleHide(block._id, breakpoint)}>${component(Icon, { entry: icon(BREAKPOINT_DEVICES[breakpoint].icon), size: 16 })}</button>`;
                    })}
                </div>
                ${blockTabs(form.tab, tab => this.showFormTab(tab), `site-block-${block._id}`)}
                ${form.tab === 'style' ? styleControls(form.style, option.supports, this.props.draft.view.presets, `site-block-${block._id}-style`, style => this.setFormStyle(style))
                : option.fields.length ? html`
                    ${option.fields.filter(field => field.kind === 'richtext').map(field => html`<div class="space-y-1"><label class="block text-sm font-medium text-foreground" for=${`site-block-${block._id}-${field.name}`}>${field.label}</label>
                        ${component(RichTextField, { id: `site-block-${block._id}-${field.name}`, label: field.label, value: (form.values[field.name] as RichTextDoc | null) ?? null, blocks: [],
                            onChange: (doc: RichTextDoc) => this.setFormValue(field.name, doc), onMedia: () => this.openChooser({ kind: 'richtext', editor: `site-block-${block._id}-${field.name}` }, false),
                            onInsertBlock: () => undefined, onEditBlock: () => undefined })}</div>`)}
                    ${blockFields({ ...option, fields: option.fields.filter(field => field.kind !== 'richtext') }, form.values, (name, value) => this.setFormValue(name, value), `site-block-${block._id}`, name => this.media({ kind: 'block', field: name }), form.errors)}`
                    : html`<p class="text-sm text-muted-foreground">${__('This block has no settings.')}</p>`}
                <div class="flex justify-end gap-2">
                    ${component(Button, { type: 'button', variant: 'outline', size: 'sm', '@click': () => { this.form = null; } }, __('Cancel'))}
                    ${component(Button, { type: 'submit', size: 'sm' }, __('Apply'))}
                </div>
            </div>
        </form>`;
    }

    /** Whether the block can move into the sibling above it. */
    private canGoIn(id: string): boolean {
        return shiftBlock(this.blocks(), id, 'in', declarationsOf(this.props.draft.view.blocks)) !== this.blocks();
    }

    private iconButton(label: string | TemplateResult, title: string, run: () => void, disabled = false): TemplateResult {
        return html`<button type="button" title=${title} aria-label=${title} ?disabled=${disabled}
            class="rounded border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer disabled:cursor-default disabled:opacity-40" @click=${run}>${label}</button>`;
    }

    private blocksPanel(): TemplateResult {
        const places = this.places();
        const drag = this.drag;
        const options = this.props.draft.view.blocks;
        return html`<div class="space-y-3">
            <p id="site-blocks-help" class="text-xs text-muted-foreground">${__('Drag a block by its handle, sideways to change its container, or focus the handle and use the arrow keys: up and down among its siblings, right into the block above, left out of its container. Click a block on the page to edit it.')}</p>
            ${places.length ? html`<ol class="relative space-y-1.5" aria-label=${__('Blocks')} ref=${(element: Element) => { this.list = element as HTMLElement; }}>
                ${drag?.moved ? html`<li aria-hidden="true" class="pointer-events-none absolute right-0 h-0.5 rounded bg-primary" style=${`top: ${drag.y}px; left: ${drag.depth * 1.25}rem`}></li>` : null}
                ${places.map((place, index) => {
                    const block = place.block;
                    const option = this.option(block.type);
                    const hide = block.layout?.hide ?? [];
                    const offered = option?.children ? offeredIn(options, option) : [];
                    return html`<li class=${`transition-opacity ${drag?.moved && index >= drag.from && index < drag.from + placeBlocks([places[drag.from]!.block]).length ? 'opacity-40' : ''}`} data-site-block=${block._id} data-depth=${place.depth}
                        style=${`padding-left: ${place.depth * 1.25}rem`} ref=${(element: Element) => { if (element) this.rows.set(block._id, element as HTMLElement); else this.rows.delete(block._id); }}>
                        <div class="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5">
                            <button type="button" class="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded border-none bg-transparent text-muted-foreground hover:bg-muted active:cursor-grabbing"
                                aria-label=${`${__('Move')} ${this.label(block)}. ${__('Drag, or use the arrow keys.')}`} aria-describedby="site-blocks-help" data-handle
                                ref=${(element: Element) => { if (element) this.handles.set(block._id, element as HTMLElement); else this.handles.delete(block._id); }}
                                @pointerdown=${(event: PointerEvent) => this.startDrag(event, index)} @pointermove=${(event: PointerEvent) => this.moveDrag(event)}
                                @pointerup=${(event: PointerEvent) => this.endDrag(event)} @pointercancel=${() => this.cancelDrag()} @lostpointercapture=${() => this.cancelDrag()}
                                @keydown=${(event: KeyboardEvent) => this.handleKey(event, block._id)}>
                                <svg aria-hidden="true" viewBox="0 0 10 16" class="h-4 w-2.5 fill-current"><circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/></svg>
                            </button>
                            <span class="min-w-0 flex-1">
                                <span class="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">${this.label(block)}${hide.length ? html` <span class="normal-case tracking-normal" data-hidden-on=${hide.join(' ')}>· ${__('hidden on')} ${hide.map(entry => __(BREAKPOINT_DEVICES[entry].label)).join(', ')}</span>` : null}</span>
                                <span class="block truncate text-sm">${this.summary(block)}</span>
                            </span>
                            ${offered.length && (option?.children?.max === null || (block.children ?? []).length < (option?.children?.max ?? 0))
                                ? component(BlockInserter, { id: `site-editor-add-${block._id}`, blocks: offered, compact: true, onPick: (type: string) => this.add(type, block._id) }) : null}
                            ${option?.fields.length ? this.iconButton(__('Edit'), `${__('Edit')} ${this.label(block)}`, () => this.edit(block._id)) : null}
                            ${this.iconButton(trash(), `${__('Remove')} ${this.label(block)}`, () => this.remove(block._id))}
                        </div>
                        ${this.form?.docked && this.form.id === block._id ? html`<div class="mt-1.5">${this.formCard()}</div>` : null}
                    </li>`;
                })}
            </ol>` : html`<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">${__('No blocks yet.')}</p>`}
            ${component(BlockInserter, { id: 'site-editor-blocks', blocks: offeredIn(options, null, this.allowed()), onPick: (type: string) => this.add(type) })}
        </div>`;
    }

    private entryPanel(): TemplateResult {
        const { view, references, errors } = this.props.draft;
        const skip = new Set([this.props.draft.blocksField, this.props.draft.bodyField]);
        const fields = view.fields.filter(field => !skip.has(field.name) && field.kind !== 'richtext' && field.kind !== 'blocks' && !field.fields.length);
        const row = (id: string, label: string, control: TemplateResult | null, name: string, bare = false) => html`<div class="space-y-1">
            ${bare ? null : html`<label for=${id} class="block text-sm font-medium">${label}</label>`}${control}
            ${errors[name] ? html`<p role="alert" class="text-xs text-destructive">${errors[name]}</p>` : null}</div>`;
        return html`<div class="space-y-4">
            ${view.titleField ? row('site-entry-title', __('Title'), html`<input id="site-entry-title" class=${CONTROL} .value=${String(this.values[view.titleField] ?? '')}
                @input=${(event: Event) => this.setValue(view.titleField, (event.target as HTMLInputElement).value)}>`, view.titleField) : null}
            ${view.slug ? row('site-entry-slug', __('Slug'), html`<input id="site-entry-slug" class=${CONTROL} .value=${String(this.values.slug ?? '')}
                @input=${(event: Event) => this.setValue('slug', (event.target as HTMLInputElement).value)}>`, 'slug') : null}
            ${view.taxonomies.map(taxonomy => {
                const value = this.values[taxonomy.name];
                if (taxonomy.hierarchical) {
                    const chosen = Array.isArray(value) ? value as string[] : [];
                    return html`<fieldset class="space-y-1.5"><legend class="text-sm font-medium">${taxonomy.label}</legend>
                        ${taxonomy.terms.map(term => html`<label class="flex items-center gap-2 text-sm cursor-pointer" style=${`padding-left: ${term.depth}rem`}>
                            ${component(Checkbox, { checked: chosen.includes(term.id), '@change': (event: Event) => this.setValue(taxonomy.name,
                                (event.target as HTMLInputElement).checked ? [...chosen, term.id] : chosen.filter(id => id !== term.id)) })} ${term.name}</label>`)}</fieldset>`;
                }
                const names = Array.isArray(value) ? (value as string[]).join(', ') : '';
                return row(`site-entry-${taxonomy.name}`, `${taxonomy.label} (${__('separate with commas')})`, html`<input id=${`site-entry-${taxonomy.name}`} class=${CONTROL} .value=${names}
                    @change=${(event: Event) => this.setValue(taxonomy.name, (event.target as HTMLInputElement).value.split(',').map(name => name.trim()).filter(Boolean))}>`, taxonomy.name);
            })}
            ${fields.map(field => row(`site-entry-${field.name}`, field.label, fieldControl(field, this.values[field.name], value => this.setValue(field.name, value), `site-entry-${field.name}`,
                { media: this.media({ kind: 'entry', field: field.name }), options: references[field.name] ?? [] }), field.name, field.kind === 'boolean'))}
            ${component(Button, { type: 'button', variant: 'outline', size: 'sm', '@click': () => this.props.onChange(this.values, true) }, __('Show changes'))}
        </div>`;
    }

    private bodyPanel(): TemplateResult | null {
        const field = this.props.draft.view.fields.find(entry => entry.name === this.props.draft.bodyField);
        if (!field) return null;
        const blocks = this.props.draft.view.blocks.filter(block => block.name !== 'core/pattern' && !block.input && (!field.blocks.length || field.blocks.includes(block.name)));
        const form = this.embedded;
        const option = form ? this.option(form.type) : undefined;
        return html`<div class="space-y-3">
            ${component(RichTextField, {
                id: BODY_EDITOR, label: field.label, value: (this.values[field.name] as RichTextDoc | null) ?? null, blocks,
                onChange: (doc: RichTextDoc) => this.setValue(field.name, doc),
                onMedia: () => this.openChooser({ kind: 'richtext' }, false),
                onInsertBlock: (type: string) => this.insertEmbedded(type),
                onEditBlock: (block: EmbeddedBlock) => this.editEmbedded(block),
            })}
            ${form && option ? html`<form class="space-y-3 rounded-md border border-border bg-card p-3" @submit=${(event: Event) => this.applyEmbedded(event)}>
                <h3 class="text-sm font-semibold">${option.label}</h3>
                ${blockFields(option, form.values, (name, value) => this.setEmbeddedValue(name, value), `site-embedded-${form.id}`, name => this.media({ kind: 'embedded', field: name }), form.errors)}
                <div class="flex justify-end gap-2">
                    ${component(Button, { type: 'button', variant: 'outline', size: 'sm', '@click': () => { this.embedded = null; } }, __('Cancel'))}
                    ${component(Button, { type: 'submit', size: 'sm' }, __('Apply'))}
                </div>
            </form>` : null}
        </div>`;
    }

    private sidePanel(): TemplateResult | null {
        if (!this.panel) return null;
        const titles = { entry: __('Entry'), blocks: __('Blocks'), body: __('Text') };
        const body = this.panel === 'entry' ? this.entryPanel() : this.panel === 'blocks' ? this.blocksPanel() : this.bodyPanel();
        return html`<aside role="dialog" aria-label=${titles[this.panel]} class=${`${PANEL} bottom-20 right-4 top-4 w-[min(30rem,calc(100vw-2rem))] rounded-lg`}>
            <header class="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <h2 class="text-base font-semibold">${titles[this.panel]}</h2>
                ${this.panel === 'body' ? component(Button, { type: 'button', size: 'sm', '@click': () => this.closeBody() }, __('Done'))
                    : component(Button, { type: 'button', variant: 'ghost', size: 'sm', '@click': () => { this.panel = null; this.form = this.form?.docked ? null : this.form; } }, __('Close'))}
            </header>
            <div class="flex-1 overflow-y-auto p-4">${body}</div>
        </aside>`;
    }

    private bar(): TemplateResult {
        const { draft, saving } = this.props;
        const tab = (panel: 'entry' | 'blocks' | 'body', label: string) => html`<button type="button" aria-pressed=${this.panel === panel ? 'true' : 'false'}
            class=${`rounded-full px-3 py-1.5 text-sm border-none cursor-pointer ${this.panel === panel ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}
            @click=${() => this.openPanel(panel)}>${label}</button>`;
        const status = saving ? __('Saving…') : draft.conflict ? '' : draft.error ? draft.error : draft.changed ? __('Unsaved changes') : __('No unsaved changes');
        const device = (name: Device) => html`<button type="button" aria-pressed=${this.device === name ? 'true' : 'false'} data-device=${name} title=${__(DEVICE_LABELS[name])}
            class=${`rounded-full px-2 py-1 text-xs border-none cursor-pointer ${this.device === name ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}
            @click=${() => this.setDevice(name)}>${__(DEVICE_LABELS[name])}</button>`;
        return html`<div role="region" aria-label=${__('Editing')} class="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center gap-1 rounded-2xl border border-border bg-background/95 px-2 py-1.5 text-foreground shadow-lg backdrop-blur">
            ${tab('entry', __('Entry'))}
            ${draft.blocksField ? tab('blocks', __('Blocks')) : null}
            ${draft.bodyField ? tab('body', __('Text')) : null}
            <span class="flex items-center gap-0.5 border-l border-border pl-1" role="group" aria-label=${__('Preview width')}>${device('desktop')}${device('tablet')}${device('phone')}</span>
            <span role="status" class=${`px-2 text-xs ${draft.error && !draft.conflict ? 'text-destructive' : 'text-muted-foreground'}`}>${status}</span>
            ${draft.conflict ? html`<span role="alert" class="flex items-center gap-2 px-2 text-xs text-destructive">${__('Someone saved this entry since you started.')}
                ${component(Button, { type: 'button', size: 'sm', variant: 'outline', '@click': () => this.props.onReload() }, __('Reload'))}</span>` : null}
            ${component(Button, { type: 'button', size: 'sm', variant: 'ghost', '@click': () => this.exit() }, __('Exit'))}
            ${component(Button, { type: 'button', size: 'sm', disabled: saving || !draft.changed || draft.conflict, '@click': () => this.props.onSave() }, __('Save'))}
        </div>`;
    }

    @Client()
    private exit() {
        if (this.props.draft.changed && !window.confirm(__('Leave edit mode? Unsaved changes will be lost.'))) return;
        this.props.onExit();
    }

    render() {
        return html`<div data-site-editor ref=${(element: Element) => { this.root = element as HTMLElement; }}>
            <p class="sr-only" aria-live="polite">${this.announcement}</p>
            ${this.form && !this.form.docked ? this.formCard() : null}
            ${this.sidePanel()}
            ${this.bar()}
            ${mediaChooser(this.props.draft.chooser, {
                search: text => this.props.onSearchMedia(text), choose: file => this.choose(file), upload: event => this.upload(event),
                close: () => this.props.onChooser({ ...this.props.draft.chooser, open: false }),
            })}
        </div>`;
    }
}
