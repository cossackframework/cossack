/**
 * The editor layout editor of the collection manager: the main column's tabs and the sidebar
 * as one block tree of editor layout blocks (tabs, sections, meta boxes, columns, grids,
 * notes), so a meta box drags between a tab and the sidebar; the sidebar is the tree's last
 * row and stays there. A side panel edits the open block (a tab's label, ID and icon), a card
 * lists the meta boxes with where each sits, and a reset restores the default arrangement. The
 * Edit tab stays first and cannot be removed. Client-safe: the screen saves the layout.
 */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input } from '@cossackframework/ui';
import { EDIT_TAB, EDITOR_LAYOUT_INSIDE, EDITOR_TAB_ID, EDITOR_TAB_RESERVED, editorTabId, findBlock, flattenBlocks, layoutBoxes, resolveEditorLayout, updateBlock, type EditorBox, type EditorLayoutAddition } from '@cossackframework/cms';
import { blockPanel } from './block-panel';
import { BlockTree } from './block-tree';
import { editorBlocks, editorInput, type BlockOption, type EditorBlock } from './editor';
import { blockFields } from './field-controls';
import { plainBlocks } from './field-group-view';
import { styleValues } from './style-controls';
import { iconSelect } from './term-icons';

/** A layout as the editor holds it: block data as control values. */
export interface EditorLayoutDraft { tabs: EditorBlock[]; sidebar: EditorBlock[] }

export type EditorLayoutEditorProps = {
    /** Page-unique prefix for control IDs. */
    id: string;
    layout: EditorLayoutDraft;
    /** The editor layout block types, with the meta boxes as the Meta box block's choices. */
    options: BlockOption[];
    /** The meta boxes the collection's editor has. */
    boxes: EditorBox[];
    /** Meta boxes the layout names that are not available now, such as a detached group's. */
    missing: string[];
    /** Tabs plugins added, by tab ID. */
    added: Record<string, string>;
    /** What active plugins add, so a reset shows what the editor shows with nothing stored. */
    additions: EditorLayoutAddition[];
    /** The screen's validation message, for the tree to open and flash the block it names. */
    error?: string;
    onChange(layout: EditorLayoutDraft): void;
};

interface Dialog { id: string; values: Record<string, unknown>; errors: Record<string, string> }

/** The sidebar's row in the layout tree. Never stored: the layout keeps the sidebar's blocks apart. */
export const SIDEBAR_ROW = 'sidebar';

/** The Edit tab first, whatever the tree did; one is made when it is gone. */
export function withEditTab(tabs: readonly EditorBlock[], label = 'Edit'): EditorBlock[] {
    const edit = tabs.find(tab => tab._id === EDIT_TAB) ?? { _id: EDIT_TAB, type: 'editor/tab', data: { label, icon: '' }, children: [] };
    return [edit, ...tabs.filter(tab => tab !== edit)];
}

/** The tabs and the sidebar as one tree, the sidebar last, so a block drags between them. */
export function layoutTree(layout: EditorLayoutDraft): EditorBlock[] {
    return [...layout.tabs, { _id: SIDEBAR_ROW, type: 'editor/sidebar', data: {}, children: layout.sidebar }];
}

/** The layout a tree holds: its tabs, the Edit tab first, and the sidebar row's blocks. */
export function layoutOfTree(blocks: readonly EditorBlock[]): EditorLayoutDraft {
    const sidebar = blocks.find(block => block._id === SIDEBAR_ROW);
    return { tabs: withEditTab(blocks.filter(block => block._id !== SIDEBAR_ROW)), sidebar: [...(sidebar?.children ?? [])] };
}

/** A new block's generated ID (`blockId`), which a tab replaces with its label's slug. */
const GENERATED_ID = /^[0-9a-f]{12}$/;

@Component()
export class EditorLayoutEditor extends Cossack {
    declare props: EditorLayoutEditorProps;
    @ClientState() private dialog: Dialog | null = null;

    private tree(): EditorBlock[] {
        return layoutTree(this.props.layout);
    }

    /** The block types the tree knows: the layout's, and the sidebar row. */
    private treeOptions(): BlockOption[] {
        return [...this.props.options, {
            name: 'editor/sidebar', label: __('Sidebar'), description: __('Beside every tab, under the Publish box.'), icon: 'sidebar-minimalistic', category: 'design', fields: [],
            children: { allowed: [...EDITOR_LAYOUT_INSIDE], max: null }, parent: [], supports: [], input: false, field: '', keywords: [], common: false,
        }];
    }

    /** A meta box's label, from the Meta box block's choices (which name the ones that are not available too). */
    private boxLabel(id: string): string {
        const choice = this.props.options.find(option => option.name === 'editor/box')?.fields.find(field => field.name === 'box')?.choices.find(entry => entry.value === id);
        return choice?.label ?? this.props.boxes.find(box => box.id === id)?.label ?? id;
    }

    @Client()
    private change(blocks: EditorBlock[]) {
        this.props.onChange(layoutOfTree(blocks));
    }

    @Client()
    private reset() {
        const layout = resolveEditorLayout(undefined, this.props.boxes, this.props.additions);
        this.dialog = null;
        this.props.onChange({ tabs: editorBlocks(layout.tabs as EditorBlock[], this.props.options), sidebar: editorBlocks(layout.sidebar as EditorBlock[], this.props.options) });
    }

    @Client()
    private open(id: string) {
        const block = findBlock(this.tree(), id);
        const option = this.props.options.find(entry => entry.name === block?.type);
        if (!block || !option) return;
        const values = Object.fromEntries(option.fields.map(field => [field.name, block.data[field.name] ?? '']));
        this.dialog = { id, errors: {}, values: block.type === 'editor/tab' ? { ...values, id: block._id } : values };
    }

    /** IDs a tab may not take: every other block's in the tree. */
    private takenIds(blocks: readonly EditorBlock[], own: string): string[] {
        return flattenBlocks(blocks).map(block => block._id).filter(id => id !== own);
    }

    /** Why a tab cannot take this ID; empty when it can. */
    private idProblem(id: string, blocks: readonly EditorBlock[], own: string): string {
        if (!EDITOR_TAB_ID.test(id)) return __('Use lowercase letters, digits and single hyphens, at most 40 characters.');
        if (EDITOR_TAB_RESERVED.includes(id)) return __('The editor keeps this ID for itself.');
        if (this.takenIds(blocks, own).includes(id)) return __('Another tab or block has this ID.');
        return '';
    }

    /** A tab whose ID is set by the layout itself: the Edit tab's, or a plugin's. */
    private fixedId(block: EditorBlock): string {
        if (block._id === EDIT_TAB) return __('The first tab\'s ID stays edit.');
        const plugin = this.props.added[block._id];
        return plugin ? `${__('Set by the plugin')} ${plugin}.` : '';
    }

    /** The panel's values go into the block at once; a value its field cannot take stays in the panel with its message. */
    @Client()
    private setValue(name: string, value: unknown) {
        const dialog = this.dialog;
        if (!dialog) return;
        const blocks = this.tree();
        const block = findBlock(blocks, dialog.id);
        const option = this.props.options.find(entry => entry.name === block?.type);
        if (!block || !option) return;
        if (name === 'id') { this.rename(block, String(value ?? '')); return; }
        let values = { ...dialog.values, [name]: value };
        const { input, errors } = editorInput(option.fields, values);
        let next = updateBlock(blocks, dialog.id, entry => ({ ...entry, data: { ...entry.data, ...input } }));
        let id = dialog.id;
        // A tab's ID follows its label while it is the generated one or the old label's slug.
        const label = String(value ?? '');
        if (block.type === 'editor/tab' && name === 'label' && label.trim() && !this.fixedId(block)) {
            const taken = this.takenIds(blocks, block._id);
            if (GENERATED_ID.test(block._id) || block._id === editorTabId(String(block.data.label ?? ''), taken)) {
                id = editorTabId(label, taken);
                next = updateBlock(next, block._id, entry => ({ ...entry, _id: id }));
                values = { ...values, id };
            }
        }
        this.dialog = { ...dialog, id, values, errors: { ...dialog.errors, [name]: '', id: id === dialog.id ? dialog.errors.id ?? '' : '', ...errors } };
        this.change(next);
    }

    /** A tab's ID typed by hand: taken when it is a free slug, kept in the panel with its message otherwise. */
    @Client()
    private rename(block: EditorBlock, value: string) {
        const dialog = this.dialog;
        if (!dialog) return;
        const blocks = this.tree();
        const id = value.trim();
        const problem = id === block._id ? '' : this.idProblem(id, blocks, block._id);
        this.dialog = { ...dialog, id: problem ? dialog.id : id, values: { ...dialog.values, id: value }, errors: { ...dialog.errors, id: problem } };
        if (!problem && id !== block._id) this.change(updateBlock(blocks, block._id, entry => ({ ...entry, _id: id })));
    }

    /** Where each meta box sits: the tab's label, the sidebar, or nowhere. */
    private places(): Map<string, string> {
        const places = new Map<string, string>();
        for (const tab of this.props.layout.tabs) for (const entry of layoutBoxes(plainBlocks(tab.children ?? []))) places.set(entry.id, String(tab.data.label ?? tab._id));
        for (const entry of layoutBoxes(plainBlocks(this.props.layout.sidebar))) places.set(entry.id, __('Sidebar'));
        return places;
    }

    /** A meta box's row shows its label; a plugin's tab says which plugin added it; the sidebar says where it shows. Called from `layoutCard()`, so the client build keeps it. */
    private summary(block: EditorBlock): string | undefined {
        if (block.type === 'editor/box') return this.boxLabel(String(block.data.box ?? ''));
        if (block.type === 'editor/tab' && this.props.added[block._id]) return `${String(block.data.label ?? '')} · ${__('added by')} ${this.props.added[block._id]}`;
        if (block.type === 'editor/sidebar') return __('Beside every tab, under the Publish box.');
        return undefined;
    }

    /** A tab's panel: its label, the ID the editor's address names, and its icon. */
    private tabFields(block: EditorBlock, option: BlockOption, dialog: Dialog, prefix: string): TemplateResult {
        const fixed = this.fixedId(block);
        const media = () => ({ previews: {}, choose: () => undefined });
        return html`
            ${blockFields({ ...option, fields: option.fields.filter(field => field.name === 'label') }, dialog.values, (name, value) => this.setValue(name, value), `${prefix}-tab`, media, dialog.errors)}
            ${component(Field, { label: __('ID'), for: `${prefix}-tab-id`, hint: fixed || __('The editor\'s address names the open tab with it: ?tab=ID. It follows the label until you change it.'), ...(dialog.errors.id ? { error: dialog.errors.id } : {}),
                control: attributes => component(Input, { ...attributes, '.value': String(dialog.values.id ?? ''), disabled: Boolean(fixed), autocomplete: 'off', spellcheck: 'false',
                    '@input': (event: Event) => this.setValue('id', (event.target as HTMLInputElement).value) }) })}
            ${iconSelect(`${prefix}-tab-icon`, String(dialog.values.icon ?? ''), value => this.setValue('icon', value), dialog.errors.icon || undefined, { hint: __('Shown before the label in the editor\'s tabs.') })}`;
    }

    private layoutCard(): TemplateResult {
        return component(Card, {}, html`
            ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Tabs and sidebar')}</h2>
                <p class="text-sm text-muted-foreground">${__('The main column shows one tab at a time: the first holds the title, and JSON follows the last. The sidebar shows beside every tab, under the Publish box. Drag a meta box between a tab and the sidebar; sections, columns and notes arrange the meta boxes inside either.')}</p>`)}
            ${component(CardBody, {}, component(BlockTree, {
                id: `${this.props.id}-tree`, blocks: this.tree(), options: this.treeOptions(), allowed: ['editor/tab'], error: this.props.error ?? '',
                pinned: [EDIT_TAB, SIDEBAR_ROW], expanded: true, devices: false, summary: (block: EditorBlock) => this.summary(block),
                onChange: (blocks: EditorBlock[]) => this.change(blocks), onEdit: (id: string) => this.open(id),
                control: () => null,
            }))}`);
    }

    render(): TemplateResult {
        const dialog = this.dialog;
        const block = dialog ? findBlock(this.tree(), dialog.id) : undefined;
        const found = this.props.options.find(entry => entry.name === block?.type) ?? null;
        const prefix = `${this.props.id}-block`;
        const places = this.places();
        // A meta box goes in one place: the panel offers the ones not placed yet, and the block's own.
        const current = block?.type === 'editor/box' ? String(block.data.box ?? '') : '';
        const option = found?.name === 'editor/box'
            ? { ...found, fields: found.fields.map(field => field.name === 'box' ? { ...field, choices: field.choices.filter(choice => choice.value === current || !places.has(choice.value)) } : field) }
            : found;
        const placed = option?.name === 'editor/box' && !option.fields.find(field => field.name === 'box')?.choices.length;
        const missing = this.props.missing.filter(id => !this.props.boxes.some(box => box.id === id));
        const general = (): TemplateResult => {
            if (!dialog || !option || !block) return html``;
            if (placed) return html`<p class="text-sm text-muted-foreground">${__('Every meta box is placed. Remove one from where it is to place it here.')}</p>`;
            if (block.type === 'editor/tab') return this.tabFields(block, option, dialog, prefix);
            return option.fields.length
                ? blockFields(option, dialog.values, (name, value) => this.setValue(name, value), `${prefix}-${dialog.id}`, () => ({ previews: {}, choose: () => undefined }), dialog.errors)
                : html`<p class="text-sm text-muted-foreground">${__('This block has no settings.')}</p>`;
        };
        return html`<div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div class="space-y-6">${this.layoutCard()}</div>
            <aside class="space-y-6">
                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Meta boxes')}</h2>
                        <p class="text-sm text-muted-foreground">${__('What the editor can show, and where each meta box sits. One the layout does not place follows at the end of the first tab or the sidebar.')}</p>`)}
                    ${component(CardBody, { class: 'space-y-4' }, html`
                        <ul class="space-y-2" aria-label=${__('Meta boxes')}>
                            ${this.props.boxes.map(box => html`<li class="flex items-start justify-between gap-2 text-sm" data-box=${box.id}>
                                <span class="min-w-0"><span class="block text-foreground">${box.label}${box.plugin ? html` <span class="text-xs text-muted-foreground">· ${box.plugin}</span>` : null}</span>
                                    ${box.note ? html`<span class="block text-xs text-muted-foreground">${__(box.note)}</span>` : null}</span>
                                ${component(Badge, { variant: places.has(box.id) ? 'outline' : 'secondary' }, places.get(box.id) ?? __('Not placed'))}
                            </li>`)}
                            ${missing.map(id => html`<li class="flex items-start justify-between gap-2 text-sm" data-box=${id}>
                                <span class="text-muted-foreground">${id}</span>${component(Badge, { variant: 'destructive' }, __('Not available'))}
                            </li>`)}
                        </ul>
                        ${component(Button, { type: 'button', variant: 'outline', size: 'sm', '@click': () => this.reset() }, __('Reset to default'))}
                    `)}`)}
            </aside>
            ${blockPanel({
                id: prefix, open: Boolean(dialog && option), option, tab: 'general', style: styleValues({}), presets: { colors: [], fontSizes: [], spacing: [] }, styleTab: false,
                onTab: () => undefined, onStyle: () => undefined, onClose: () => { this.dialog = null; },
                general: general(),
            })}
        </div>`;
    }
}
