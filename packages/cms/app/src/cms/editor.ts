/**
 * The entry editor's model: plain, serializable views of a collection's fields, and the
 * conversion from form values to typed record input. Client-safe; the server converts and
 * validates again before writing.
 */
import { slugify, validateValue, type BlockCategory, type BlockCondition, type BlockStyle, type Breakpoint, type FieldDeclaration, type FieldKind, type StyleProperty, type ThemePresets } from '@cossackframework/cms';
import { conditionInput } from './condition-control';

/** One field as the editor shows it. */
export interface EditorField {
    name: string;
    label: string;
    kind: FieldKind;
    required: boolean;
    nullable: boolean;
    description: string;
    placement: 'main' | 'sidebar';
    format: 'plain' | 'markdown' | 'code';
    /** enum values, with labels. */
    choices: { value: string; label: string }[];
    /** Several values of the kind, as a list; `minItems` and `maxItems` bound it and `addLabel` names the Add button. */
    multiple: boolean;
    minItems: number | null;
    maxItems: number | null;
    addLabel: string;
    media: boolean;
    /** reference: the target resource, with selectable entries. */
    target: string;
    /** blocks: the block types allowed, or all. */
    blocks: string[];
    /** blocks: the field holds a form, so input blocks are offered. */
    form: boolean;
    min: number | null;
    max: number | null;
    /** The declared default, if any. */
    defaultValue: unknown;
    /** A group's subfields, such as an entry's SEO settings; empty otherwise. */
    fields: EditorField[];
}

export interface TermOption { id: string; name: string; depth: number }

export interface EditorTaxonomy {
    name: string;
    label: string;
    singular: string;
    hierarchical: boolean;
    terms: TermOption[];
}

export interface BlockOption {
    name: string;
    label: string;
    description: string;
    /** Solar icon name; see `blockIcon`. */
    icon: string;
    category: BlockCategory;
    fields: EditorField[];
    /** A container: the types it holds (empty for any) and how many at most. Null for a leaf block. */
    children: { allowed: string[]; max: number | null } | null;
    /** Types this block goes inside alone, such as a column in columns. */
    parent: string[];
    /** The Style tab's properties, from the type's supports and category. */
    supports: StyleProperty[];
    /** A form input, offered only in a form's blocks. */
    input: boolean;
    /** A field block's kind, offered only in a field group; empty otherwise. */
    field: string;
    /** Other words the picker's search matches. */
    keywords: string[];
    /** Offered in forms and field groups too. */
    common: boolean;
}

/** A field group attached to the entry's collection, as the editor shows it: a box of its layout. */
export interface EditorGroup {
    id: string;
    title: string;
    description: string;
    placement: 'main' | 'sidebar';
    blocks: EditorBlock[];
}

/** A block as editors hold it: its data as control values, nested blocks under a container. */
export interface EditorBlock {
    _id: string;
    type: string;
    data: Record<string, unknown>;
    layout?: { hide?: Breakpoint[]; anchor?: string; className?: string };
    style?: BlockStyle;
    /** In a form: when the block shows. */
    when?: BlockCondition;
    children?: EditorBlock[];
}

export interface EditorView {
    /** Resource ID, such as `cms/posts`. */
    resource: string;
    /** The route segment: `posts`, or `<owner>.<name>` for plugin resources. */
    route: string;
    label: string;
    singular: string;
    titleField: string;
    /** Saving needs a title that is not blank. */
    titleRequired: boolean;
    slug: boolean;
    publishable: boolean;
    hierarchical: boolean;
    /** Public URL base, or null when entries are not on the site. */
    path: string | null;
    fields: EditorField[];
    taxonomies: EditorTaxonomy[];
    blocks: BlockOption[];
    /** The active theme's presets, for the blocks' Style tab. */
    presets: Required<ThemePresets>;
    /** The blocks a new entry's content starts with, and how far they may change. */
    template: EditorBlock[];
    templateLock?: 'all' | 'insert';
    /** Field groups attached to the collection, in order. */
    groups: EditorGroup[];
    /** Every collection, for blocks that name one, such as Latest entries. */
    collections: { name: string; label: string }[];
    /** Every term with its taxonomy, for blocks that pick one. */
    termChoices: { id: string; name: string; taxonomy: string; depth: number }[];
}

/** Values the form controls hold: strings, booleans and lists. */
export type EditorValues = Record<string, unknown>;

/** Editor fields of a declaration, leaving out the ones the editor lays out itself. */
export function editorFields(fields: { readonly [name: string]: FieldDeclaration }, special: readonly string[]): EditorField[] {
    return Object.entries(fields).filter(([name]) => !special.includes(name)).map(([name, declaration]) => editorField(name, declaration));
}

export function editorField(name: string, declaration: FieldDeclaration & { choices?: { readonly [value: string]: string } }): EditorField {
    const sidebar = declaration.kind === 'boolean' || (declaration.media === true && declaration.kind === 'string' && !declaration.multiple) || declaration.kind === 'reference';
    return {
        name, label: declaration.label ?? name, kind: declaration.kind, required: declaration.required === true, nullable: declaration.nullable === true,
        description: declaration.description ?? '', placement: declaration.placement ?? (sidebar ? 'sidebar' : 'main'),
        format: declaration.format ?? 'plain',
        choices: (declaration.values ?? []).map(value => ({ value, label: declaration.choices?.[value] ?? value })),
        multiple: declaration.multiple === true, minItems: declaration.minItems ?? null, maxItems: declaration.maxItems ?? null, addLabel: declaration.addLabel ?? '',
        media: declaration.media === true, target: declaration.target ?? '', blocks: [...(declaration.blocks ?? [])], form: declaration.form === true,
        min: declaration.min ?? null, max: declaration.max ?? null, defaultValue: declaration.default ?? null,
        fields: Object.entries(declaration.fields ?? {}).map(([sub, nested]) => editorField(sub, nested)),
    };
}

/** The value a control shows for a stored value. */
export function controlValue(field: EditorField, value: unknown): unknown {
    // A multiple field edits as a list of its kind's control values.
    if (field.multiple) return (Array.isArray(value) ? value : []).map(item => controlValue({ ...field, multiple: false }, item));
    // Rows edit as a list of objects of their fields' control values, each with its id.
    if (field.kind === 'rows') {
        return (Array.isArray(value) ? value : []).map(row => {
            const object = row && typeof row === 'object' ? row as Record<string, unknown> : {};
            return { _id: typeof object._id === 'string' ? object._id : '', ...Object.fromEntries(field.fields.map(sub => [sub.name, controlValue(sub, object[sub.name])])) };
        });
    }
    // A group edits as an object of its subfields' control values.
    if (field.fields.length) {
        const object = value && typeof value === 'object' ? value as Record<string, unknown> : {};
        return Object.fromEntries(field.fields.map(sub => [sub.name, controlValue(sub, object[sub.name])]));
    }
    if (value === null || value === undefined) {
        if (field.kind === 'boolean') return false;
        if (field.kind === 'blocks') return [];
        if (field.kind === 'richtext') return null;
        return '';
    }
    switch (field.kind) {
        case 'datetime': return new Date(value as number).toISOString().slice(0, 16);
        case 'json': return JSON.stringify(value, null, 2);
        case 'integer': case 'number': return String(value);
        case 'blocks': case 'richtext': return value;
        default: return value;
    }
}

/** A declaration to validate a converted value against. */
function declarationOf(field: EditorField): FieldDeclaration {
    return {
        kind: field.kind, required: field.required, nullable: field.nullable,
        ...(field.min !== null ? { min: field.min } : {}), ...(field.max !== null ? { max: field.max } : {}),
        ...(field.choices.length ? { values: field.choices.map(choice => choice.value) } : {}),
        ...(field.multiple ? { multiple: true, ...(field.minItems !== null ? { minItems: field.minItems } : {}), ...(field.maxItems !== null ? { maxItems: field.maxItems } : {}) } : {}),
        ...(field.fields.length ? { fields: Object.fromEntries(field.fields.map(sub => [sub.name, declarationOf(sub)])) } : {}),
    };
}

/**
 * Typed input from control values. Empty optional controls clear nullable fields and keep the
 * others unchanged; unreadable text is reported per field.
 */
export function editorInput(fields: readonly EditorField[], values: EditorValues, blocks: readonly BlockOption[] = []): { input: Record<string, unknown>; errors: Record<string, string> } {
    const input: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    for (const field of fields) {
        if (!(field.name in values)) continue;
        const converted = convert(field, values[field.name], blocks);
        if ('error' in converted) errors[field.name] = converted.error;
        else if (converted.value !== undefined) input[field.name] = converted.value;
    }
    return { input, errors };
}

function convert(field: EditorField, raw: unknown, blocks: readonly BlockOption[]): { value: unknown } | { error: string } {
    // A multiple field's items convert as the kind does; blank ones are left out, and the server checks the count.
    if (field.multiple) {
        const items: unknown[] = [];
        for (const [index, entry] of (Array.isArray(raw) ? raw : []).entries()) {
            const converted = convert({ ...field, multiple: false, nullable: true }, entry, blocks);
            if ('error' in converted) return { error: `${__('item')} ${index + 1} ${converted.error}` };
            if (converted.value !== undefined && converted.value !== null && converted.value !== '') items.push(converted.value);
        }
        return { value: items };
    }
    if (field.kind === 'rows') {
        // Each row keeps its id and the fields that were set; the server checks what is required.
        const rows: Record<string, unknown>[] = [];
        for (const [index, row] of (Array.isArray(raw) ? raw : []).entries()) {
            const source = row && typeof row === 'object' ? row as Record<string, unknown> : {};
            const converted: Record<string, unknown> = typeof source._id === 'string' && source._id ? { _id: source._id } : {};
            for (const sub of field.fields) {
                const value = convert(sub, source[sub.name], blocks);
                if ('error' in value) return { error: `${__('row')} ${index + 1}: ${sub.label} ${value.error}` };
                if (value.value !== undefined && value.value !== null && value.value !== '' && value.value !== false) converted[sub.name] = value.value;
            }
            rows.push(converted);
        }
        return { value: rows };
    }
    if (field.fields.length) {
        // Empty subfields and unchecked boxes are left out, so the group holds only what was set.
        const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const group: Record<string, unknown> = {};
        for (const sub of field.fields) {
            const converted = convert(sub, source[sub.name], blocks);
            if ('error' in converted) return { error: `${sub.label} ${converted.error}` };
            if (converted.value !== undefined && converted.value !== null && converted.value !== '' && converted.value !== false) group[sub.name] = converted.value;
        }
        return { value: Object.keys(group).length ? group : field.nullable ? null : {} };
    }
    if (field.kind === 'boolean') return { value: raw === true || raw === 'true' || raw === 'on' };
    // The editor's JSON document; the server validates it.
    if (field.kind === 'richtext') return { value: raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : field.nullable ? null : undefined };
    if (field.kind === 'blocks') {
        if (!Array.isArray(raw)) return { value: [] };
        const converted = blocksInput(raw as EditorBlock[], new Map(blocks.map(block => [block.name, block])));
        return 'error' in converted ? converted : { value: converted.value };
    }
    const text = typeof raw === 'string' ? (field.kind === 'text' || field.kind === 'json' ? raw : raw.trim()) : raw === undefined || raw === null ? '' : String(raw);
    if (text === '') {
        if (field.nullable) return { value: null };
        // An empty optional string is a value when the field accepts it; otherwise nothing changes.
        if ((field.kind === 'string' || field.kind === 'text') && validateValue(field.name, declarationOf(field), '') === undefined) return { value: '' };
        return { value: undefined };
    }
    switch (field.kind) {
        case 'integer': { const value = Number(text); return Number.isSafeInteger(value) ? { value } : { error: 'must be a whole number.' }; }
        case 'number': { const value = Number(text); return Number.isFinite(value) ? { value } : { error: 'must be a number.' }; }
        case 'datetime': {
            const value = Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text) ? `${text}Z` : text);
            return Number.isNaN(value) ? { error: 'must be a date and time.' } : { value };
        }
        case 'json': try { return { value: JSON.parse(text) }; } catch { return { error: 'must be valid JSON.' }; }
        default: return { value: text };
    }
}

/** Typed blocks from editor blocks, through the tree; a block's `layout` and `children` come along. */
export function blocksInput(raw: readonly EditorBlock[], types: ReadonlyMap<string, BlockOption>): { value: EditorBlock[] } | { error: string } {
    const converted: EditorBlock[] = [];
    for (const block of raw) {
        const data: Record<string, unknown> = {};
        for (const entry of types.get(block.type)?.fields ?? []) {
            const value = convert(entry, block.data?.[entry.name], []);
            if ('error' in value) return { error: `${entry.label} ${value.error}` };
            if (value.value !== undefined && value.value !== null && value.value !== '') data[entry.name] = value.value;
        }
        const layout = blockLayoutInput(block.layout);
        const style = Object.fromEntries(Object.entries(block.style ?? {}).filter(([, value]) => typeof value === 'string' && value)) as BlockStyle;
        const children = Array.isArray(block.children) ? blocksInput(block.children, types) : undefined;
        if (children && 'error' in children) return children;
        const when = conditionInput(block.when);
        converted.push({ _id: block._id, type: block.type, data, ...(layout ? { layout } : {}), ...(Object.keys(style).length ? { style } : {}), ...(when ? { when } : {}), ...(children ? { children: children.value } : {}) });
    }
    return { value: converted };
}

/** A block's layout without empty entries; undefined when it has none. */
function blockLayoutInput(layout: EditorBlock['layout']): EditorBlock['layout'] | undefined {
    const hide = layout?.hide?.filter(Boolean) ?? [];
    const anchor = layout?.anchor?.trim() ?? '';
    const className = layout?.className?.trim() ?? '';
    const result = { ...(hide.length ? { hide } : {}), ...(anchor ? { anchor } : {}), ...(className ? { className } : {}) };
    return Object.keys(result).length ? result : undefined;
}

/** The slug an untouched slug field follows. */
export function suggestedSlug(title: string): string {
    return slugify(title) || '';
}

/** The public URL of an entry, from the collection path and the slugs of its ancestors. */
export { entryUrl } from '@cossackframework/cms';

/** A new block's data: each field's default, or empty. */
export function blockDefaults(block: BlockOption): Record<string, unknown> {
    return Object.fromEntries(block.fields.map(field => [field.name, controlValue(field, field.defaultValue)]));
}

/** A new block of a type: defaults, and for columns two columns to start with. */
export function newBlock(type: string, options: readonly BlockOption[], id: () => string): EditorBlock | null {
    const option = options.find(entry => entry.name === type);
    if (!option) return null;
    const block: EditorBlock = { _id: id(), type, data: blockDefaults(option), ...(option.children ? { children: [] } : {}) };
    if (type === 'core/columns') block.children = [1, 2].flatMap(() => newBlock('core/column', options, id) ?? []);
    return block;
}

/** Stored block data as control values, through the tree, so the editor's controls can show them. */
export function editorBlocks(blocks: readonly EditorBlock[], options: readonly BlockOption[]): EditorBlock[] {
    return blocks.map(block => {
        const option = options.find(entry => entry.name === block.type);
        return {
            ...block, data: option ? Object.fromEntries(option.fields.map(field => [field.name, controlValue(field, block.data[field.name])])) : { ...block.data },
            ...(block.children ? { children: editorBlocks(block.children, options) } : {}),
        };
    });
}
