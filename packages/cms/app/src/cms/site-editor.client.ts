/**
 * The editor on the public site, loaded only in edit mode. Click a block to edit its fields
 * in a sheet at the side, as the dashboard's editor does, with Apply and Cancel; click the body
 * to edit it as one document in the rich text editor. The Blocks panel shows the tree: drag a
 * block, or use the arrow keys, to move it among its siblings or into and out of containers;
 * the Entry panel edits the title, slug, terms and other fields. The device toggle narrows the
 * content root. The editor's controls sit in the middle of the site taskbar, between its start
 * menu and its user menu. Changes stay in the page's draft until saved.
 */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Button, Checkbox, Icon, MultiSelect, Sheet } from '@cossackframework/ui';
import { blockId, BREAKPOINTS, findBlock, formatNoteTarget, insertBlock, noteBlock, noteThreads, parseNoteTarget, parseRichTextPath, placeBlocks, removeBlock, richTextPath, shiftBlock, updateBlock, type BlockMove, type BlockPlace, type Breakpoint, type EmbeddedBlock, type Note, type NoteRange, type NoteStatus, type RichTextDoc } from '@cossackframework/cms';
import { blockDefaults, controlValue, editorInput, newBlock, type BlockOption, type EditorValues } from './editor';
import { BREAKPOINT_DEVICES, blockSummary, declarationsOf, offeredIn } from './block-tree';
import { icon } from './icons';
import { blockFields, fieldControl, type MediaHooks, type MediaPreview } from './field-controls';
import { blockTabs, styleControls, styleValues, withStyle, type BlockTab, type StyleValues } from './style-controls';
import { chooserKind, mediaChooser, uploadMedia, withFile } from './media-chooser';
import { RichTextField, richTextEditors, type RichTextFieldProps } from './rich-text-field';
import type { NoteMark } from './rich-text.client';
import { noteButton, noteMarker, notesRail, type NoteAnchorView, type NoteComposer } from './notes-rail';
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

/** A block's form, in the sheet at the side of the page. */
interface BlockForm { id: string; values: Record<string, unknown>; style: StyleValues; tab: BlockTab; errors: Record<string, string> }
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
    // Notes: the rail and its state; the notes themselves live in the draft, written through the content API.
    @ClientState() private notesOpen = false;
    @ClientState() private notesFilter: NoteStatus = 'open';
    @ClientState() private composer: NoteComposer | null = null;
    @ClientState() private editingNote: { id: string; body: string } | null = null;
    @ClientState() private activeNote: string | null = null;
    @ClientState() private notesBusy = false;
    @ClientState() private notesError = '';
    @ClientState() private detachedNotes: string[] = [];
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
        if (!target || this.root?.contains(target) || target.closest('dialog, [role="dialog"]')) return;
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
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        // A block's form is a dialog: its own cancel closes it (`closeForm`).
        if (this.form) return;
        if (this.embedded) this.embedded = null;
        else if (this.panel) this.panel = null;
    };

    private readonly onLeave = (event: BeforeUnloadEvent) => {
        if (this.props.draft.changed) event.preventDefault();
    };

    private readonly onResize = () => this.placeBar();

    onMount() {
        this.style = document.createElement('style');
        this.style.textContent = STYLE;
        document.head.appendChild(this.style);
        document.addEventListener('click', this.onDocumentClick, true);
        document.addEventListener('keydown', this.onKey);
        window.addEventListener('beforeunload', this.onLeave);
        window.addEventListener('resize', this.onResize);
        this.observer = new MutationObserver(() => { this.syncSelection(); this.placeBar(); });
        this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-block-id'] });
        this.placeBar();
    }

    onCleanup() {
        this.observer?.disconnect();
        this.style?.remove();
        document.removeEventListener('click', this.onDocumentClick, true);
        document.removeEventListener('keydown', this.onKey);
        window.removeEventListener('beforeunload', this.onLeave);
        window.removeEventListener('resize', this.onResize);
        for (const marker of document.querySelectorAll('[data-cms-selected]')) marker.removeAttribute('data-cms-selected');
        delete document.documentElement.dataset.cmsDevice;
        document.documentElement.style.removeProperty('--cms-taskbar-start');
        document.documentElement.style.removeProperty('--cms-taskbar-end');
    }

    /**
     * Place the editing controls in the middle of the site taskbar: between its start menu and its
     * user menu, which the bar keeps while editing (`taskbar.ts`). Without a taskbar (narrow
     * screens show none) the controls span the bottom of the page.
     */
    @Client()
    private placeBar() {
        const bar = document.querySelector('[data-cms-taskbar]');
        const start = bar?.querySelector('[data-taskbar-start]')?.getBoundingClientRect();
        const end = bar?.querySelector('[data-taskbar-end]')?.getBoundingClientRect();
        const shown = !!bar && getComputedStyle(bar).display !== 'none';
        const left = shown && start?.width ? `${Math.round(start.right)}px` : '0px';
        const right = shown && end?.width ? `${Math.max(0, Math.round(window.innerWidth - end.left))}px` : '0px';
        const root = document.documentElement.style;
        if (root.getPropertyValue('--cms-taskbar-start') !== left) root.setProperty('--cms-taskbar-start', left);
        if (root.getPropertyValue('--cms-taskbar-end') !== right) root.setProperty('--cms-taskbar-end', right);
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

    /** Open a block's form in the sheet. */
    @Client()
    private select(id: string, _marker: Element | null = null) {
        const block = findBlock(this.blocks(), id);
        const option = block ? this.option(block.type) : undefined;
        if (!block || !option) return;
        this.form = {
            id, errors: {}, tab: this.form?.tab ?? 'general', style: styleValues(block),
            values: Object.fromEntries(option.fields.map(field => [field.name, block.data[field.name] ?? controlValue(field, field.defaultValue)])),
        };
    }

    /** Close the form; from a nested block's form, Escape selects its container instead. */
    @Client()
    private closeForm(toParent = false) {
        const parent = toParent && this.form ? this.places().find(place => place.block._id === this.form!.id)?.parent ?? null : null;
        if (parent) this.edit(parent); else this.form = null;
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
        this.setBlocks(updateBlock(this.blocks(), form.id, entry => withStyle({ ...entry, data: { ...form.values } }, form.style, this.otherIds(form.id))));
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

    // --- Notes: review threads, through the content API (the site has no room) -------------

    private openRoots(): Note[] {
        return this.props.draft.notes.filter(note => !note.parentId && note.status === 'open');
    }

    /** Open threads on a block, counting the passages inside it. */
    private blockNoteCount(id: string): number {
        return this.openRoots().filter(note => { const target = parseNoteTarget(note.target); return !!target && noteBlock(target)?.block === id; }).length;
    }

    private fieldLabel(name: string): string {
        const { view } = this.props.draft;
        return view.fields.find(field => field.name === name)?.label ?? view.taxonomies.find(taxonomy => taxonomy.name === name)?.label ?? name;
    }

    /** The notes of a rich text document, for its editor, and the toolbar's Note. */
    private notesFor(path: string): Partial<Pick<RichTextFieldProps, 'notes' | 'onNote'>> {
        const marks = this.props.draft.notes.filter(note => !note.parentId && note.status === 'open' && note.target === `text:${path}`).map(note => ({ id: note.id, range: note.range, quote: note.quote }));
        return {
            notes: { marks, active: this.activeNote, onClick: (id: string) => this.selectNote(id), onMoved: (placed: readonly NoteMark[]) => this.onNotesPlaced(path, placed) },
            onNote: (range: NoteRange | null, quote: string) => {
                const parsed = parseRichTextPath(path);
                const whole = parsed?.block ? formatNoteTarget({ kind: 'block', field: parsed.field, block: parsed.block.id }) : formatNoteTarget({ kind: 'field', field: parsed?.field ?? path });
                this.startNote(range ? `text:${path}` : whole, range, quote);
            },
        };
    }

    @Client()
    private onNotesPlaced(path: string, placed: readonly NoteMark[]) {
        const found = new Set(placed.map(mark => mark.id));
        const here = (id: string) => this.props.draft.notes.find(note => note.id === id)?.target === `text:${path}`;
        const detached = this.props.draft.notes.filter(note => !note.parentId && note.status === 'open' && here(note.id) && !found.has(note.id)).map(note => note.id);
        const next = [...this.detachedNotes.filter(id => !here(id)), ...detached].sort();
        if (next.join() !== [...this.detachedNotes].sort().join()) this.detachedNotes = next;
    }

    private noteAnchor(root: Note): NoteAnchorView {
        const target = parseNoteTarget(root.target);
        if (!target || target.kind === 'entry') return { label: __('This entry'), quote: '', detached: false };
        if (target.kind === 'field') return { label: this.fieldLabel(target.field), quote: '', detached: false };
        const at = noteBlock(target);
        if (!at) return { label: this.fieldLabel(target.kind === 'text' ? target.path : ''), quote: root.quote, detached: this.detachedNotes.includes(root.id) };
        const block = findBlock(this.blocks(), at.block);
        const option = block ? this.option(block.type) : undefined;
        const label = block ? option?.label ?? block.type : __('A removed block');
        const summary = block ? blockSummary(block, this.props.draft.previews, option) : '';
        if (target.kind === 'block') return { label: summary ? `${label}: ${summary}` : label, quote: '', detached: !block };
        return { label, quote: root.quote, detached: !block || this.detachedNotes.includes(root.id) };
    }

    @Client()
    private startNote(target: string, range: NoteRange | null = null, quote = '') {
        this.composer = { target, range, quote, parentId: null, body: '' };
        this.editingNote = null;
        this.activeNote = null;
        this.notesFilter = 'open';
        this.notesError = '';
        this.notesOpen = true;
    }

    @Client()
    private selectNote(id: string) {
        const root = this.props.draft.notes.find(note => note.id === id);
        this.activeNote = id;
        if (root) this.notesFilter = root.status;
        this.notesOpen = true;
        const target = root ? parseNoteTarget(root.target) : null;
        const block = target ? noteBlock(target) : null;
        if (block) document.querySelector(`[data-cms-edit="block"][data-block-id="${CSS.escape(block.block)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    /** Open the rail on a block's notes, the first open thread there chosen. */
    @Client()
    private showBlockNotes(id: string) {
        const first = this.openRoots().find(note => { const target = parseNoteTarget(note.target); return !!target && noteBlock(target)?.block === id; });
        this.notesFilter = 'open';
        this.notesOpen = true;
        if (first) this.activeNote = first.id;
    }

    private notesPath(): string {
        return `/api/cms/content/${this.props.draft.collection}/${this.props.draft.id}/notes`;
    }

    /** A call to the content API as the signed-in editor; the answer's JSON, or its error as a message. */
    private async noteRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
        const response = await fetch(path, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        if (response.status === 204) return undefined as T;
        const data = await response.json().catch(() => ({})) as T & { error?: string };
        if (!response.ok) throw new Error(data.error || __('The note could not be saved.'));
        return data;
    }

    @Client()
    private async postNote() {
        const composer = this.composer;
        if (!composer || !composer.body.trim()) return;
        this.notesBusy = true;
        this.notesError = '';
        try {
            const { note } = await this.noteRequest<{ note: Note }>('POST', this.notesPath(), composer.parentId
                ? { parentId: composer.parentId, body: composer.body } : { target: composer.target, range: composer.range, quote: composer.quote, body: composer.body });
            this.composer = null;
            this.props.onNotes([...this.props.draft.notes.map(entry => entry.id === note.parentId ? { ...entry, updatedAt: note.createdAt } : entry), note]);
            this.activeNote = note.parentId ?? note.id;
        } catch (error) { this.notesError = (error as Error).message; }
        finally { this.notesBusy = false; }
    }

    /** Change a note's text or a thread's status; the answer replaces the note. */
    @Client()
    private async patchNote(id: string, body: { body?: string; status?: NoteStatus }) {
        this.notesBusy = true;
        this.notesError = '';
        try {
            const { note } = await this.noteRequest<{ note: Note }>('PATCH', `/api/cms/notes/${id}`, body);
            this.props.onNotes(this.props.draft.notes.map(entry => entry.id === note.id ? note : entry));
            if (this.editingNote?.id === id) this.editingNote = null;
        } catch (error) { this.notesError = (error as Error).message; }
        finally { this.notesBusy = false; }
    }

    @Client()
    private async removeNote(id: string) {
        const note = this.props.draft.notes.find(entry => entry.id === id);
        if (!note || !window.confirm(note.parentId ? __('Remove this reply?') : __('Remove this thread and its replies?'))) return;
        this.notesBusy = true;
        this.notesError = '';
        try {
            await this.noteRequest<undefined>('DELETE', `/api/cms/notes/${id}`);
            this.props.onNotes(this.props.draft.notes.filter(entry => entry.id !== id && entry.parentId !== id));
            if (this.activeNote === id) this.activeNote = null;
        } catch (error) { this.notesError = (error as Error).message; }
        finally { this.notesBusy = false; }
    }

    private notesRailView(): TemplateResult | null {
        const { draft } = this.props;
        return notesRail({
            id: 'site-notes', open: this.notesOpen, threads: noteThreads(draft.notes), filter: this.notesFilter, people: draft.people, me: draft.me, admin: draft.admin,
            active: this.activeNote, composer: this.composer, editing: this.editingNote, mentionable: draft.mentionable, busy: this.notesBusy, error: this.notesError,
            anchor: root => this.noteAnchor(root),
            onClose: () => { this.notesOpen = false; }, onFilter: filter => { this.notesFilter = filter; }, onSelect: id => this.selectNote(id),
            onCompose: composer => { this.composer = composer; }, onSubmit: () => { void this.postNote(); },
            onEdit: editing => { this.editingNote = editing; }, onSaveEdit: () => { if (this.editingNote?.body.trim()) void this.patchNote(this.editingNote.id, { body: this.editingNote.body }); },
            onResolve: id => { void this.patchNote(id, { status: 'resolved' }); }, onReopen: id => { void this.patchNote(id, { status: 'open' }); }, onRemove: id => { void this.removeNote(id); },
        });
    }

    // --- Media -----------------------------------------------------------------------------

    @Client()
    private openChooser(target: ChooserTarget, multiple: boolean) {
        this.chooserTarget = target;
        this.props.onChooser({ ...this.props.draft.chooser, open: true, error: '', field: 'field' in target ? target.field : '', multiple, kind: this.fileKind(target) });
        this.props.onSearchMedia(this.props.draft.chooser.search);
    }

    /** The kind of file a target's field asks for first: its declared kinds, images otherwise. */
    private fileKind(target: ChooserTarget): string {
        if (target.kind === 'richtext') return 'image';
        const type = target.kind === 'entry' ? null : target.kind === 'embedded' ? this.embedded?.type : this.form ? findBlock(this.blocks(), this.form.id)?.type : undefined;
        const fields = target.kind === 'entry' ? this.props.draft.view.fields : type ? this.option(type)?.fields ?? [] : [];
        return chooserKind(fields.find(field => field.name === target.field));
    }

    @Client()
    private filterMedia(kind: string) {
        this.props.onChooser({ ...this.props.draft.chooser, kind });
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
        this.props.onChooser({ ...this.props.draft.chooser, error });
        for (const file of files) this.choose(file);
        this.props.onSearchMedia('');
    }

    // --- Rendering -------------------------------------------------------------------------

    /**
     * The block's form in a sheet at the side, as the dashboard's block panel: a header with the
     * block's name and its move and remove buttons, the settings scrolling between, and Cancel
     * and Apply fixed at the bottom. Escape in a nested block's form selects its container.
     */
    private formSheet(): TemplateResult {
        const form = this.form;
        const block = form ? findBlock(this.blocks(), form.id) : undefined;
        const option = block ? this.option(block.type) : undefined;
        const open = !!form && !!block && !!option;
        return component(Sheet, { id: 'site-editor-block', open, side: 'right', size: '30rem', 'aria-label': option ? `${__('Edit')} ${option.label}` : __('Block'),
            onOpenChange: (next: boolean) => { if (!next) this.closeForm(true); } },
            open ? this.formBody(form, block, option) : html``);
    }

    private formBody(form: BlockForm, block: DraftBlock, option: BlockOption): TemplateResult {
        const place = this.places().find(entry => entry.block._id === block._id)!;
        const siblings = place.parent ? findBlock(this.blocks(), place.parent)?.children ?? [] : this.blocks();
        const hide = block.layout?.hide ?? [];
        return html`<form data-site-editor-form class="flex h-full flex-col" @submit=${(event: Event) => this.apply(event)}>
            <header class="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
                <h2 class="min-w-0 truncate text-base font-semibold text-foreground">${option.label}</h2>
                <span class="flex flex-wrap gap-1">
                    ${this.iconButton('↑', __('Move up'), () => this.shift(block._id, 'up'), place.index === 0)}
                    ${this.iconButton('↓', __('Move down'), () => this.shift(block._id, 'down'), place.index === siblings.length - 1)}
                    ${this.iconButton('←', __('Move out of the container'), () => this.shift(block._id, 'out'), !place.parent)}
                    ${this.iconButton('→', __('Move into the block above'), () => this.shift(block._id, 'in'), !this.canGoIn(block._id))}
                    ${this.iconButton(trash(), `${__('Remove')} ${option.label}`, () => this.remove(block._id))}
                </span>
            </header>
            <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
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
                ${blockTabs(form.tab, tab => this.showFormTab(tab), `site-block-${block._id}`, {
                    style: styleControls(form.style, option.supports, this.props.draft.view.presets, `site-block-${block._id}-style`, style => this.setFormStyle(style), { taken: this.otherIds(block._id) }),
                    general: option.fields.length ? html`
                    ${option.fields.filter(field => field.kind === 'richtext').map(field => html`<div class="space-y-1"><label class="block text-sm font-medium text-foreground" for=${`site-block-${block._id}-${field.name}`}>${field.label}</label>
                        ${component(RichTextField, { id: `site-block-${block._id}-${field.name}`, label: field.label, value: (form.values[field.name] as RichTextDoc | null) ?? null, blocks: [],
                            onChange: (doc: RichTextDoc) => this.setFormValue(field.name, doc), onMedia: () => this.openChooser({ kind: 'richtext', editor: `site-block-${block._id}-${field.name}` }, false),
                            onInsertBlock: () => undefined, onEditBlock: () => undefined,
                            ...(this.props.draft.blocksField ? this.notesFor(richTextPath(this.props.draft.blocksField, { id: block._id, key: field.name })) : {}) })}</div>`)}
                    ${blockFields({ ...option, fields: option.fields.filter(field => field.kind !== 'richtext') }, form.values, (name, value) => this.setFormValue(name, value), `site-block-${block._id}`, name => this.media({ kind: 'block', field: name }), form.errors, [], this.props.draft.view.sources)}`
                    : html`<p class="text-sm text-muted-foreground">${__('This block has no settings.')}</p>`,
                })}
            </div>
            <footer class="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
                ${component(Button, { type: 'button', variant: 'outline', size: 'sm', '@click': () => this.closeForm() }, __('Cancel'))}
                ${component(Button, { type: 'submit', size: 'sm' }, __('Apply'))}
            </footer>
        </form>`;
    }

    /** The IDs of every other block in the field, which a custom block ID may not repeat. */
    private otherIds(id: string): ReadonlySet<string> {
        return new Set(this.places().map(place => place.block._id).filter(entry => entry !== id));
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
                            ${noteMarker(this.blockNoteCount(block._id), this.label(block), () => this.showBlockNotes(block._id))}
                            ${this.props.draft.blocksField ? noteButton(`site-note-${block._id}`, this.label(block), () => this.startNote(formatNoteTarget({ kind: 'block', field: this.props.draft.blocksField!, block: block._id })), { always: true }) : null}
                            ${option?.fields.length ? this.iconButton(__('Edit'), `${__('Edit')} ${this.label(block)}`, () => this.edit(block._id)) : null}
                            ${this.iconButton(trash(), `${__('Remove')} ${this.label(block)}`, () => this.remove(block._id))}
                        </div>
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
                return row(`site-entry-${taxonomy.name}`, taxonomy.label, component(MultiSelect, {
                    id: `site-entry-${taxonomy.name}`, value: Array.isArray(value) ? value as string[] : [],
                    options: [...new Set(taxonomy.terms.map(term => term.name))], allowCreate: true,
                    placeholder: __('Search or add…'), emptyLabel: __('No matching terms.'),
                    createLabel: (name: string) => `${__('Create')} "${name}"`, removeLabel: (name: string) => `${__('Remove')} ${name}`,
                    onValueChange: (names: string[]) => this.setValue(taxonomy.name, names),
                }), taxonomy.name);
            })}
            ${fields.map(field => row(`site-entry-${field.name}`, field.label, fieldControl(field, this.values[field.name], value => this.setValue(field.name, value), `site-entry-${field.name}`,
                { media: this.media({ kind: 'entry', field: field.name }), options: references[field.name] ?? [], sources: this.props.draft.view.sources }), field.name, field.kind === 'boolean'))}
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
                ...this.notesFor(richTextPath(field.name)),
            })}
            ${form && option ? html`<form class="space-y-3 rounded-md border border-border bg-card p-3" @submit=${(event: Event) => this.applyEmbedded(event)}>
                <h3 class="text-sm font-semibold">${option.label}</h3>
                ${blockFields(option, form.values, (name, value) => this.setEmbeddedValue(name, value), `site-embedded-${form.id}`, name => this.media({ kind: 'embedded', field: name }), form.errors, [], this.props.draft.view.sources)}
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
        // The open Notes rail takes the right edge: the panel sits beside it.
        return html`<aside role="dialog" aria-label=${titles[this.panel]} class=${`${PANEL} bottom-12 right-4 top-4 w-[min(30rem,calc(100vw-2rem))] rounded-lg`} style=${this.notesOpen ? 'right: 27rem' : ''}>
            <header class="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <h2 class="text-base font-semibold">${titles[this.panel]}</h2>
                ${this.panel === 'body' ? component(Button, { type: 'button', size: 'sm', '@click': () => this.closeBody() }, __('Done'))
                    : component(Button, { type: 'button', variant: 'ghost', size: 'sm', '@click': () => { this.panel = null; } }, __('Close'))}
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
        // In the taskbar's middle, between its start menu and its user menu (`placeBar`); the whole bottom edge without a taskbar.
        return html`<div role="region" aria-label=${__('Editing')} data-site-editor-bar class="fixed bottom-0 z-50 flex h-10 items-center gap-1 overflow-x-auto border-t border-border bg-background/95 px-2 text-foreground backdrop-blur md:border-t-0 md:bg-transparent md:backdrop-blur-none"
            style="left: var(--cms-taskbar-start, 0px); right: var(--cms-taskbar-end, 0px)">
            ${tab('entry', __('Entry'))}
            ${draft.blocksField ? tab('blocks', __('Blocks')) : null}
            ${draft.bodyField ? tab('body', __('Text')) : null}
            <button type="button" aria-pressed=${this.notesOpen ? 'true' : 'false'} data-notes-toggle=${this.openRoots().length}
                class=${`rounded-full px-3 py-1.5 text-sm border-none cursor-pointer ${this.notesOpen ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}
                @click=${() => { this.notesOpen = !this.notesOpen; }}>${__('Notes')}${this.openRoots().length ? html` <span class="rounded-full bg-amber-500/15 px-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">${this.openRoots().length}</span>` : null}</button>
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
            ${this.formSheet()}
            ${this.sidePanel()}
            ${this.notesRailView()}
            ${this.bar()}
            ${mediaChooser(this.props.draft.chooser, {
                search: text => this.props.onSearchMedia(text), filter: kind => this.filterMedia(kind), choose: file => this.choose(file), upload: event => this.upload(event),
                close: () => this.props.onChooser({ ...this.props.draft.chooser, open: false }),
            })}
        </div>`;
    }
}
