/**
 * A field group as an editor shows it: the group's layout blocks as dashboard UI (sections,
 * columns, grids, tabs, headings, notes, rules) and its field blocks as controls, which the
 * screen renders since it owns media choosing. A repeater's rows are collapsible sections
 * with their own fields, reordered with buttons; rows nest. Client-safe.
 */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Badge, Button, Icon } from '@cossackframework/ui';
import { blockId, hiddenKey, type Block, type BlockDeclaration } from '@cossackframework/cms';
import { controlValue, type BlockOption, type EditorBlock, type EditorField } from './editor';
import { icon } from './icons';
import { iconButton } from './ui';

/** Where a value sits: the rows fields above it, with the row IDs, from the top down. */
export type RowPath = { field: string; id: string }[];

export type FieldGroupViewProps = {
    /** Page-unique prefix for control IDs. */
    id: string;
    blocks: EditorBlock[];
    options: BlockOption[];
    /** The fields the blocks declare, as the editor holds them, at this level. */
    fields: EditorField[];
    values: Record<string, unknown>;
    onChange(name: string, value: unknown): void;
    /** Keys of the blocks the conditions hide; see `hiddenKey`. */
    hidden: ReadonlySet<string>;
    /** Messages by field name at this level. */
    errors?: Record<string, string>;
    /** A field's control, given where it sits. Null renders the generic control's place empty. */
    control(field: EditorField, value: unknown, change: (value: unknown) => void, rows: RowPath, id: string): TemplateResult | null;
    /** The rows above this view, for nested views. */
    rows?: RowPath;
};

/** The block types as declarations, enough for `fieldVisibility`: which blocks are field blocks and of what kind. */
export function visibilityTypes(options: readonly BlockOption[]): ReadonlyMap<string, BlockDeclaration> {
    return new Map(options.map(option => [option.name, { name: option.name, label: option.label, fields: {}, ...(option.field ? { field: { kind: option.field as never } } : {}), ...(option.children ? { children: {} } : {}) }]));
}

/** The widths of a field block in the six-column grid. */
const WIDTHS: Record<string, string> = { full: 'col-span-6', half: 'col-span-6 sm:col-span-3', third: 'col-span-6 sm:col-span-2' };

@Component()
export class FieldGroupView extends Cossack {
    declare props: FieldGroupViewProps;
    @ClientState() private tabs: Record<string, number> = {};
    @ClientState() private collapsed: Record<string, boolean> = {};

    private option(type: string): BlockOption | undefined {
        return this.props.options.find(entry => entry.name === type);
    }

    private rowKey(name: string, id: string): string {
        return `${this.props.id}:${name}:${id}`;
    }

    @Client()
    private showTab(id: string, index: number) {
        this.tabs = { ...this.tabs, [id]: index };
    }

    @Client()
    private toggleRow(key: string, collapsed: boolean) {
        this.collapsed = { ...this.collapsed, [key]: collapsed };
    }

    /** A new row: an ID and each field's default. */
    private newRow(field: EditorField): Record<string, unknown> {
        return { _id: blockId(), ...Object.fromEntries(field.fields.map(sub => [sub.name, controlValue(sub, sub.defaultValue)])) };
    }

    private rowsOf(name: string): Record<string, unknown>[] {
        const value = this.props.values[name];
        return Array.isArray(value) ? value as Record<string, unknown>[] : [];
    }

    private list(blocks: readonly EditorBlock[]): TemplateResult {
        return html`<div class="grid grid-cols-6 gap-4">${blocks.map(block => {
            const option = this.option(block.type);
            if (this.props.hidden.has(hiddenKey((this.props.rows ?? []).map(row => ({ name: row.field, id: row.id })), block.id))) return null;
            const width = option?.field ? WIDTHS[String(block.data.width ?? 'full')] ?? WIDTHS.full : 'col-span-6';
            return html`<div class=${width}>${option?.field ? this.fieldBlock(block, option) : this.layoutBlock(block, option)}</div>`;
        })}</div>`;
    }

    private layoutBlock(block: EditorBlock, option: BlockOption | undefined): TemplateResult | null {
        const children = block.children ?? [];
        switch (block.type) {
            case 'core/heading': return html`<h3 class="text-base font-semibold text-foreground">${String(block.data.text ?? '')}</h3>`;
            case 'core/paragraph': return html`<p class="whitespace-pre-line text-sm text-muted-foreground">${String(block.data.text ?? '')}</p>`;
            case 'core/divider': return html`<hr class="border-border">`;
            case 'core/columns': return html`<div class=${`grid gap-4 ${children.length > 1 ? `sm:grid-cols-${Math.min(children.length, 6)}` : ''}`}>${children.map(column => this.list(column.children ?? []))}</div>`;
            case 'core/grid': {
                const columns = Math.min(Math.max(Number(block.data.columns) || 2, 1), 6);
                return html`<div class=${`grid gap-4 sm:grid-cols-${columns}`}>${children.map(child => html`<div>${this.list([child])}</div>`)}</div>`;
            }
            case 'core/tabs': {
                const active = Math.min(this.tabs[block.id] ?? 0, Math.max(children.length - 1, 0));
                const prefix = `${this.props.id}-${block.id}`;
                return html`<div class="space-y-3">
                    <div role="tablist" class="flex flex-wrap border-b border-border">${children.map((tab, index) => html`<button type="button" role="tab" id=${`${prefix}-tab-${index}`} aria-selected=${active === index ? 'true' : 'false'} aria-controls=${`${prefix}-panel-${index}`}
                        class=${`-mb-px inline-flex items-center gap-1.5 border-b-2 bg-transparent px-3 py-1.5 text-sm font-medium cursor-pointer [&_svg]:size-4 ${active === index ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                        @click=${() => this.showTab(block.id, index)}>${typeof tab.data.icon === 'string' && tab.data.icon ? component(Icon, { entry: icon(tab.data.icon), size: 16 }) : null}${String(tab.data.label ?? '')}</button>`)}</div>
                    ${children.map((tab, index) => active === index ? html`<div role="tabpanel" id=${`${prefix}-panel-${index}`} aria-labelledby=${`${prefix}-tab-${index}`}>${this.list(tab.children ?? [])}</div>` : null)}
                </div>`;
            }
            default: return option?.children ? html`<div class="space-y-4">${this.list(children)}</div>` : null;
        }
    }

    private fieldBlock(block: EditorBlock, option: BlockOption): TemplateResult | null {
        const name = typeof block.data.name === 'string' ? block.data.name : '';
        const field = this.props.fields.find(entry => entry.name === name);
        if (!field) return null;
        if (option.field === 'repeater') return this.repeater(block, field);
        const id = [this.props.id, ...(this.props.rows ?? []).map(row => `${row.field}-${row.id}`), name].join('-');
        const error = this.props.errors?.[name];
        return html`<div class="space-y-1.5">
            ${field.kind === 'boolean' ? null : html`<label for=${id} class="block text-sm font-medium text-foreground">${field.label}${field.required ? html`<span class="text-destructive"> *</span>` : null}</label>`}
            ${this.props.control(field, this.props.values[name], value => this.props.onChange(name, value), this.props.rows ?? [], id)}
            ${field.description ? html`<p class="text-xs text-muted-foreground">${field.description}</p>` : null}
            ${error ? html`<p role="alert" class="text-xs text-destructive">${field.label} ${error}</p>` : null}
        </div>`;
    }

    /** A row's title: its summary field, or its first text, or its number. */
    private rowTitle(block: EditorBlock, field: EditorField, row: Record<string, unknown>, index: number): string {
        const summary = typeof block.data.summary === 'string' && block.data.summary ? block.data.summary : field.fields.find(sub => sub.kind === 'string' && !sub.media)?.name;
        const value = summary ? row[summary] : undefined;
        return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : `${field.label} ${index + 1}`;
    }

    private repeater(block: EditorBlock, field: EditorField): TemplateResult {
        const name = field.name;
        const rows = this.rowsOf(name);
        const max = field.max ?? 200;
        const set = (next: Record<string, unknown>[]) => this.props.onChange(name, next);
        const move = (index: number, delta: number) => {
            const to = index + delta;
            if (to < 0 || to >= rows.length) return;
            const next = [...rows];
            [next[index], next[to]] = [next[to]!, next[index]!];
            set(next);
        };
        const prefix = `${this.props.id}-${block.id}`;
        return html`<fieldset class="space-y-2 rounded-lg border border-border p-3" aria-describedby=${`${prefix}-count`}>
            <legend class="px-1 text-sm font-medium text-foreground">${field.label}${field.required ? html`<span class="text-destructive"> *</span>` : null}</legend>
            ${field.description ? html`<p class="text-xs text-muted-foreground">${field.description}</p>` : null}
            <p id=${`${prefix}-count`} class="sr-only">${rows.length} ${rows.length === 1 ? __('row') : __('rows')}</p>
            ${rows.map((row, index) => {
                const id = typeof row._id === 'string' ? row._id : String(index);
                const key = this.rowKey(name, id);
                // Rows start open at the top level and closed inside another repeater.
                const collapsed = this.collapsed[key] ?? (this.props.rows?.length ?? 0) > 0;
                const title = this.rowTitle(block, field, row, index);
                const rowPath: RowPath = [...(this.props.rows ?? []), { field: name, id }];
                return html`<section class="rounded-md border border-border bg-card" aria-label=${`${field.label} ${index + 1}`}>
                    <header class="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
                        <button type="button" class="inline-flex h-7 w-6 shrink-0 items-center justify-center rounded border-none bg-transparent text-muted-foreground hover:bg-muted cursor-pointer [&_svg]:size-4"
                            aria-expanded=${collapsed ? 'false' : 'true'} aria-label=${`${collapsed ? __('Expand') : __('Collapse')} ${title}`} @click=${() => this.toggleRow(key, !collapsed)}>
                            ${component(Icon, { entry: icon(collapsed ? 'alt-arrow-right' : 'alt-arrow-down'), size: 16 })}</button>
                        <span class="min-w-0 flex-1 truncate text-sm text-foreground">${title}</span>
                        ${collapsed ? component(Badge, { variant: 'outline' }, String(index + 1)) : null}
                        <span class="flex items-center gap-1">
                            ${iconButton(`${prefix}-${id}-up`, 'arrow-up', `${__('Move up')} ${title}`, () => move(index, -1), { disabled: index === 0 })}
                            ${iconButton(`${prefix}-${id}-down`, 'arrow-down', `${__('Move down')} ${title}`, () => move(index, 1), { disabled: index === rows.length - 1 })}
                            ${iconButton(`${prefix}-${id}-remove`, 'trash-bin-trash', `${__('Remove')} ${title}`, () => set(rows.filter((_, at) => at !== index)), { danger: true })}
                        </span>
                    </header>
                    ${collapsed ? null : html`<div class="border-t border-border p-3">${component(FieldGroupView, {
                        id: `${prefix}-${id}`, blocks: block.children ?? [], options: this.props.options, fields: field.fields, values: row, hidden: this.props.hidden, rows: rowPath,
                        onChange: (sub: string, value: unknown) => set(rows.map((entry, at) => at === index ? { ...entry, [sub]: value } : entry)),
                        control: this.props.control,
                    })}</div>`}
                </section>`;
            })}
            <div class="flex flex-wrap items-center gap-2">
                ${component(Button, { type: 'button', variant: 'outline', size: 'sm', disabled: rows.length >= max, '@click': () => set([...rows, this.newRow(field)]) }, `${__('Add')} ${field.label.toLowerCase()}`)}
                ${rows.length >= max ? html`<span class="text-xs text-muted-foreground">${__('At most')} ${max} ${__('rows')}.</span>` : null}
            </div>
            ${this.props.errors?.[name] ? html`<p role="alert" class="text-xs text-destructive">${field.label} ${this.props.errors[name]}</p>` : null}
        </fieldset>`;
    }

    render(): TemplateResult {
        return this.list(this.props.blocks);
    }
}

/** The blocks of a group as plain blocks, for `fieldVisibility`. */
export function plainBlocks(blocks: readonly EditorBlock[]): Block[] {
    return blocks as unknown as Block[];
}
