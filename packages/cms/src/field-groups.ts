/**
 * Field groups: meta boxes built from blocks. A group lays typed fields out with the core
 * layout blocks and attaches to collections, taxonomies, users or menu items; its field
 * blocks compile to field declarations, so storage, the API and themes see fields, never
 * layout. A repeater is a field block whose children are the fields of its rows, nested
 * without limit; a field block with Multiple on holds several values of its kind. Pure
 * functions, shared by the dashboard and the host.
 */
import { field, fieldProblems, FIELD_NAME, ITEM_LIMITS, ROW_ID, ROW_LIMITS, validateValue, type FieldDeclaration, type FieldKind } from './fields';
import { FIELD_BLOCK_KINDS, flattenBlocks, validateBlocks, type Block, type BlockDeclaration, type FieldBlockKind } from './blocks';
import { conditionShows, type FormValue, type FormValues } from './form-builder';

// --- Field blocks -------------------------------------------------------------------------

/** The builder's field types as the picker shows them. */
export const FIELD_BLOCK_TYPES: readonly { readonly kind: FieldBlockKind; readonly label: string; readonly icon: string; readonly description: string }[] = Object.freeze([
    { kind: 'text', label: 'Single line', icon: 'text-field', description: 'One line of text, such as a subtitle or SKU.' },
    { kind: 'textarea', label: 'Long text', icon: 'text-square', description: 'Plain paragraphs.' },
    { kind: 'markdown', label: 'Rich text', icon: 'text-bold-square', description: 'Markdown with a toolbar and preview.' },
    { kind: 'number', label: 'Number', icon: 'hashtag-square', description: 'Prices, ratings and measurements.' },
    { kind: 'integer', label: 'Whole number', icon: 'hashtag', description: 'Counts and positions.' },
    { kind: 'boolean', label: 'Yes / no', icon: 'check-square', description: 'A checkbox.' },
    { kind: 'date', label: 'Date and time', icon: 'calendar', description: 'Stored in UTC.' },
    { kind: 'choice', label: 'Choice', icon: 'list', description: 'One of a fixed list.' },
    { kind: 'media', label: 'Image or file', icon: 'gallery', description: 'A file from the media library; a gallery with Multiple on.' },
    { kind: 'reference', label: 'Reference', icon: 'link-round', description: 'An entry of another collection.' },
    { kind: 'blocks', label: 'Blocks', icon: 'widget-4', description: 'Content built from blocks, such as headings, images and buttons.' },
    { kind: 'json', label: 'JSON', icon: 'code-square', description: 'Structured data for developers.' },
    { kind: 'repeater', label: 'Repeater', icon: 'layers-minimalistic', description: 'Rows of fields, added as needed. Rows can hold repeaters of their own.' },
]);

const LABEL = field.string({ required: true, max: 200, label: 'Label' });
const NAME = field.string({ max: 63, pattern: FIELD_NAME.source.slice(1, -1), label: 'Field name', description: 'The API, themes and filters use this name. Taken from the label when empty.' });
const HELP = field.string({ max: 500, label: 'Help text' });
const REQUIRED = field.boolean({ default: false, label: 'Required' });
const WIDTH = field.enum(['full', 'half', 'third'], { default: 'full', label: 'Width', choices: { full: 'Full width', half: 'Half', third: 'A third' } });
const INDEX = field.boolean({ default: false, label: 'Filterable', description: 'Keeps an index, so lists can filter on this field.' });
const SEARCH = field.boolean({ default: false, label: 'Searchable' });
const DEFAULT = field.string({ max: 500, label: 'Default value' });
const MAX_LENGTH = field.integer({ min: 1, max: 100_000, label: 'Maximum length' });
/** Several values of the kind: a text with Multiple on is a list of texts, an image a gallery. */
const MULTIPLE_SETTINGS: { readonly [name: string]: FieldDeclaration } = {
    multiple: field.boolean({ default: false, label: 'Multiple', description: 'Several values, added one at a time.' }),
    minItems: field.integer({ min: 0, max: ITEM_LIMITS.max, label: 'Fewest values' }),
    maxItems: field.integer({ min: 1, max: ITEM_LIMITS.max, label: 'Most values' }),
    addLabel: field.string({ max: 60, label: 'Add button', description: 'The button that adds a value; "Add new" when empty.' }),
};
/** Field kinds that are one value by nature. */
const SINGLE_KINDS: ReadonlySet<FieldBlockKind> = new Set<FieldBlockKind>(['boolean', 'blocks', 'repeater']);

/** The fields every field block has, then its own, then the Multiple settings unless the kind is one value by nature. */
export function fieldBlockFields(own: { readonly [name: string]: FieldDeclaration } = {}, options: { readonly multiple?: boolean } = {}): { [name: string]: FieldDeclaration } {
    return { label: LABEL, name: NAME, description: HELP, required: REQUIRED, width: WIDTH, ...own, ...(options.multiple === false ? {} : MULTIPLE_SETTINGS) };
}

const declare = (kind: FieldBlockKind, own: { readonly [name: string]: FieldDeclaration } = {}, extra: Partial<BlockDeclaration> = {}): BlockDeclaration => {
    const type = FIELD_BLOCK_TYPES.find(entry => entry.kind === kind)!;
    return { name: `field/${kind}`, label: type.label, icon: type.icon, category: 'field', description: type.description, field: { kind }, fields: fieldBlockFields(own, { multiple: !SINGLE_KINDS.has(kind) }), ...extra };
};

/** The field blocks of earlier builds: a List is a Single line with Multiple on, a Gallery an Image or file. */
const LEGACY_FIELD_BLOCKS: { readonly [type: string]: string } = { 'field/list': 'field/text', 'field/gallery': 'field/media' };

/** A stored block tree with the field blocks of earlier builds read as today's, at any depth. */
export function upgradeFieldBlocks(blocks: readonly Block[]): Block[] {
    return blocks.map(block => {
        const type = LEGACY_FIELD_BLOCKS[block.type];
        const next = type ? { ...block, type, data: { ...block.data, multiple: true } } : block;
        return next.children ? { ...next, children: upgradeFieldBlocks(next.children) } : next;
    });
}

/** Built-in field blocks, one per builder type. */
export const FIELD_BLOCKS: readonly BlockDeclaration[] = Object.freeze([
    declare('text', { max: MAX_LENGTH, unique: field.boolean({ default: false, label: 'Unique', description: 'No two entries share a value.' }), index: INDEX, search: SEARCH, defaultValue: DEFAULT }),
    declare('textarea', { max: MAX_LENGTH, search: SEARCH }),
    declare('markdown', { max: MAX_LENGTH, search: SEARCH }),
    declare('number', { min: field.number({ label: 'Minimum' }), max: field.number({ label: 'Maximum' }), index: INDEX, defaultValue: DEFAULT }),
    declare('integer', { min: field.integer({ label: 'Minimum' }), max: field.integer({ label: 'Maximum' }), index: INDEX, defaultValue: DEFAULT }),
    declare('boolean', { defaultValue: field.boolean({ default: false, label: 'Checked by default' }) }),
    declare('date', { index: INDEX }),
    declare('choice', { choices: field.list('string', { label: 'Choices' }), index: INDEX, defaultValue: DEFAULT }),
    declare('media'),
    declare('reference', { target: field.string({ required: true, max: 40, pattern: '[a-z][a-z0-9_]*', label: 'Collection' }), index: INDEX }),
    declare('blocks', { blocks: field.list('string', { label: 'Allowed blocks', description: 'Block type names; empty allows all.' }) }),
    declare('json'),
    declare('repeater', {
        min: field.integer({ min: 0, max: ROW_LIMITS.max, label: 'Fewest rows' }),
        max: field.integer({ min: 1, max: ROW_LIMITS.max, label: 'Most rows' }),
        summary: field.string({ max: 63, pattern: FIELD_NAME.source.slice(1, -1), label: 'Row title', description: 'The field whose value names a collapsed row; the first text field when empty.' }),
    }, { children: {} }),
]);

/** Kinds a row field can have an index on: scalar values an array index can hold. */
const INDEXABLE_ROW_KINDS = new Set<FieldKind>(['string', 'enum', 'integer', 'number', 'boolean', 'datetime', 'reference']);

/** The declaration one field block describes. Its repeater children are the rows' fields. */
export function fieldBlockDeclaration(block: Block, types: ReadonlyMap<string, BlockDeclaration>): FieldDeclaration | null {
    const kind = types.get(block.type)?.field?.kind;
    if (!kind) return null;
    const data = block.data;
    const text = (key: string) => typeof data[key] === 'string' ? (data[key] as string).trim() : '';
    const number = (key: string) => typeof data[key] === 'number' && Number.isFinite(data[key]) ? data[key] as number : undefined;
    const flag = (key: string) => data[key] === true;
    const required = flag('required');
    const multiple = flag('multiple') && !SINGLE_KINDS.has(kind);
    const common: Partial<FieldDeclaration> = {
        label: text('label') || text('name'),
        ...(text('description') ? { description: text('description') } : {}),
        ...(required ? { required: true } : {}),
        ...(multiple ? {
            multiple: true,
            ...(number('minItems') !== undefined ? { minItems: number('minItems') } : {}),
            ...(number('maxItems') !== undefined ? { maxItems: number('maxItems') } : {}),
            ...(text('addLabel') ? { addLabel: text('addLabel') } : {}),
        } : {}),
    };
    const max = number('max');
    const min = number('min');
    const bounds = { ...(max !== undefined ? { max } : {}), ...(min !== undefined ? { min } : {}) };
    const index = flag('index') ? { index: true } : {};
    const search = flag('search') ? { search: true } : {};
    // A multiple field's default is one value per line; an empty line is no value.
    const defaultText = text('defaultValue');
    const defaults = multiple ? defaultText.split('\n').map(line => line.trim()).filter(Boolean) : defaultText ? [defaultText] : [];
    const fallback = <T extends string | number>(values: readonly T[]): { default?: T | readonly T[] } => !values.length ? {} : multiple ? { default: values } : { default: values[0]! };
    // A single optional value may be null; a multiple one is an empty list.
    const optional = multiple ? {} : { nullable: !required };
    switch (kind) {
        case 'text': return field.string({ ...common, ...(max !== undefined ? { max } : {}), ...(flag('unique') && !multiple ? { unique: true } : index), ...search, ...fallback(defaults) });
        case 'textarea': return field.text({ ...common, ...(max !== undefined ? { max } : {}), ...search });
        case 'markdown': return field.text({ ...common, format: 'markdown', ...(max !== undefined ? { max } : {}), ...search });
        case 'number': return field.number({ ...common, ...bounds, ...optional, ...index, ...fallback(defaults.map(Number).filter(value => Number.isFinite(value))) });
        case 'integer': return field.integer({ ...common, ...bounds, ...optional, ...index, ...fallback(defaults.map(Number).filter(value => Number.isSafeInteger(value))) });
        case 'boolean': return field.boolean({ ...common, default: data.defaultValue === true });
        case 'date': return field.datetime({ ...common, ...optional, ...index });
        case 'choice': {
            const values = (Array.isArray(data.choices) ? data.choices as unknown[] : []).map(value => String(value).trim()).filter(Boolean);
            return field.enum(values, { ...common, ...optional, ...index, ...fallback(defaults.filter(value => values.includes(value))) });
        }
        case 'media': return field.media({ ...common, ...optional });
        case 'reference': return field.reference(`cms/${text('target')}`, { ...common, ...optional, ...index });
        case 'blocks': {
            const blocks = (Array.isArray(data.blocks) ? data.blocks as unknown[] : []).map(value => String(value).trim()).filter(Boolean);
            return field.blocks({ ...common, ...(blocks.length ? { blocks } : {}) });
        }
        case 'json': return field.json(common);
        case 'repeater': return field.rows(fieldGroupDeclarations(block.children ?? [], types), { ...common, ...bounds });
    }
}

/**
 * The fields a group's blocks declare, in document order: field blocks become declarations,
 * layout blocks contribute what they hold, and a repeater's children are its rows' fields.
 */
export function fieldGroupDeclarations(blocks: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>): { [name: string]: FieldDeclaration } {
    const fields: { [name: string]: FieldDeclaration } = {};
    const visit = (list: readonly Block[]) => {
        for (const block of list) {
            const type = types.get(block.type);
            if (type?.field) {
                const declaration = fieldBlockDeclaration(block, types);
                const name = typeof block.data.name === 'string' ? block.data.name.trim() : '';
                if (declaration && name) fields[name] = declaration;
            } else if (block.children) visit(block.children);
        }
    };
    visit(blocks);
    return fields;
}

/** The field blocks of a group at any depth, repeater children included. */
export function flattenGroupFields(blocks: readonly Block[]): Block[] {
    return flattenBlocks(blocks).filter(block => block.type.startsWith('field/'));
}

/** The field block kind a declaration is edited as. */
export function fieldBlockKindOf(declaration: FieldDeclaration): FieldBlockKind {
    switch (declaration.kind) {
        case 'string': return declaration.media ? 'media' : 'text';
        case 'text': return declaration.format === 'markdown' ? 'markdown' : 'textarea';
        case 'number': return 'number';
        case 'integer': case 'bigint': return 'integer';
        case 'boolean': return 'boolean';
        case 'datetime': return 'date';
        case 'enum': return 'choice';
        case 'reference': return 'reference';
        case 'blocks': case 'richtext': return 'blocks';
        case 'rows': return 'repeater';
        default: return 'json';
    }
}

/** The field block that edits a declaration, with its rows' fields as children. */
export function fieldBlockOf(name: string, declaration: FieldDeclaration, id = name): Block {
    const kind = fieldBlockKindOf(declaration);
    const data: { [key: string]: unknown } = { name, label: declaration.label ?? name };
    if (declaration.description) data.description = declaration.description;
    if (declaration.required) data.required = true;
    if (declaration.max !== undefined && kind !== 'media') data.max = declaration.max;
    if (declaration.min !== undefined) data.min = declaration.min;
    if (declaration.unique) data.unique = true;
    if (declaration.index && kind !== 'media') data.index = true;
    if (declaration.multiple) {
        data.multiple = true;
        if (declaration.minItems !== undefined) data.minItems = declaration.minItems;
        if (declaration.maxItems !== undefined) data.maxItems = declaration.maxItems;
        if (declaration.addLabel) data.addLabel = declaration.addLabel;
    }
    if (declaration.search) data.search = true;
    if (kind === 'choice') data.choices = [...(declaration.values ?? [])];
    if (kind === 'reference') data.target = declaration.target?.startsWith('cms/') ? declaration.target.slice(4) : declaration.target ?? '';
    if (kind === 'blocks' && declaration.blocks?.length) data.blocks = [...declaration.blocks];
    if (declaration.default !== undefined && declaration.default !== null) data.defaultValue = kind === 'boolean' ? declaration.default === true : Array.isArray(declaration.default) ? declaration.default.map(String).join('\n') : String(declaration.default);
    const children = kind === 'repeater' ? Object.entries(declaration.fields ?? {}).map(([sub, nested]) => fieldBlockOf(sub, nested, `${id}-${sub}`)) : undefined;
    return { _id: id, type: `field/${kind}`, data, ...(children ? { children } : {}) };
}

/** A layout for declared fields: one field block each, in order. */
export function layoutOf(fields: { readonly [name: string]: FieldDeclaration }, order: readonly string[] = []): Block[] {
    const names = [...order.filter(name => Object.hasOwn(fields, name)), ...Object.keys(fields).filter(name => !order.includes(name))];
    return names.map(name => fieldBlockOf(name, fields[name]!));
}

// --- Groups -------------------------------------------------------------------------------

/** Where a field group shows. `order` places the box among the target's groups; the group's own `order` is the fallback. */
export type FieldGroupTarget = { readonly kind: 'collection' | 'taxonomy'; readonly name: string; readonly order?: number } | { readonly kind: 'users' | 'menus'; readonly order?: number };

export interface FieldGroup {
    /** 1-40 letters, digits, `_` or `-`. */
    readonly id: string;
    readonly title: string;
    readonly description?: string;
    /** Where the box shows in an entry editor. Terms, users and menu items have one column. */
    readonly placement?: 'main' | 'sidebar';
    /** Boxes of one target in ascending order, for targets without their own `order`. */
    readonly order?: number;
    readonly targets: readonly FieldGroupTarget[];
    readonly blocks: readonly Block[];
}

export const FIELD_GROUP_ID = /^[A-Za-z0-9_-]{1,40}$/;
export const FIELD_GROUP_LIMITS = Object.freeze({ title: 120, description: 500, targets: 50 });

/** Whether two targets are the same place; their order does not count. */
export function sameTarget(a: FieldGroupTarget, b: FieldGroupTarget): boolean {
    return a.kind === b.kind && ('name' in a ? a.name : '') === ('name' in b ? b.name : '');
}

/** A group's place among a target's boxes: the target's order, or the group's. */
export function targetOrder(group: FieldGroup, target: FieldGroupTarget): number {
    return group.targets.find(entry => sameTarget(entry, target))?.order ?? group.order ?? 0;
}

/** The groups attached to a target, in their order there, then by the group's order and ID. */
export function groupsForTarget(groups: readonly FieldGroup[], target: FieldGroupTarget): FieldGroup[] {
    return groups.filter(group => group.targets.some(entry => sameTarget(entry, target)))
        .sort((a, b) => targetOrder(a, target) - targetOrder(b, target) || (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
}

/** The group with the target attached at `order` (in its place when already there), or without it. */
export function withTarget(group: FieldGroup, target: FieldGroupTarget, attached: boolean, order?: number): FieldGroup {
    const { order: _order, ...place } = target;
    const next = { ...place, ...(order !== undefined ? { order } : {}) };
    const index = group.targets.findIndex(entry => sameTarget(entry, target));
    if (!attached) return { ...group, targets: group.targets.filter(entry => !sameTarget(entry, target)) };
    return { ...group, targets: index === -1 ? [...group.targets, next] : group.targets.map((entry, at) => at === index ? next : entry) };
}

/**
 * Problems in a group, with its blocks checked as a field group: empty when valid. `scope`
 * names the target's own fields, which the group's cannot take and conditions may test.
 * Returns the checked blocks too, with names filled in from labels.
 */
export function fieldGroupProblems(group: FieldGroup, types: ReadonlyMap<string, BlockDeclaration>, scope: readonly string[] = []): { problems: string[]; blocks: Block[]; fields: { [name: string]: FieldDeclaration } } {
    const problems: string[] = [];
    if (typeof group?.id !== 'string' || !FIELD_GROUP_ID.test(group.id)) problems.push('The ID must be 1-40 letters, digits, underscores or hyphens.');
    if (typeof group?.title !== 'string' || !group.title.trim() || group.title.length > FIELD_GROUP_LIMITS.title) problems.push(`The title is required and at most ${FIELD_GROUP_LIMITS.title} characters.`);
    if (group?.description !== undefined && (typeof group.description !== 'string' || group.description.length > FIELD_GROUP_LIMITS.description)) problems.push(`The description is at most ${FIELD_GROUP_LIMITS.description} characters.`);
    if (group?.placement !== undefined && !['main', 'sidebar'].includes(group.placement)) problems.push('Placement is main or sidebar.');
    if (group?.order !== undefined && !Number.isSafeInteger(group.order)) problems.push('Order is a whole number.');
    const targets = Array.isArray(group?.targets) ? group.targets : [];
    if (!Array.isArray(group?.targets) || targets.length > FIELD_GROUP_LIMITS.targets) problems.push(`Targets list where the group shows, at most ${FIELD_GROUP_LIMITS.targets}.`);
    for (const [index, target] of targets.entries()) {
        const valid = target && typeof target === 'object' && (((target.kind === 'collection' || target.kind === 'taxonomy') && typeof (target as { name?: unknown }).name === 'string' && /^[a-z][a-zA-Z0-9_]{0,40}$/.test((target as { name: string }).name))
            || ((target.kind === 'users' || target.kind === 'menus') && !('name' in target)));
        if (!valid) problems.push(`Target ${index + 1} is not a collection, taxonomy, users or menus.`);
        else if (target.order !== undefined && !Number.isSafeInteger(target.order)) problems.push(`Target ${index + 1}: the order is a whole number.`);
        else if (targets.slice(0, index).some(other => sameTarget(other, target))) problems.push(`Target ${index + 1} is listed twice.`);
    }
    if (!Array.isArray(group?.blocks)) return { problems: [...problems, 'Blocks are required.'], blocks: [], fields: {} };
    const checked = validateBlocks(group.blocks, types, { fieldGroup: { scope } });
    problems.push(...Object.entries(checked.errors).map(([path, message]) => `Block ${path}: ${message}`));
    const fields = fieldGroupDeclarations(checked.blocks, types);
    for (const [name, declaration] of Object.entries(fields)) problems.push(...fieldProblems(name, declaration), ...rowIndexProblems(name, declaration));
    return { problems, blocks: checked.blocks, fields };
}

/** A row field with an index must hold a scalar an array index can hold. */
function rowIndexProblems(name: string, declaration: FieldDeclaration): string[] {
    if (declaration.kind !== 'rows') return [];
    return Object.entries(declaration.fields ?? {}).flatMap(([sub, nested]) => [
        ...((nested.index || nested.unique) && (!INDEXABLE_ROW_KINDS.has(nested.kind) || nested.multiple) ? [`field ${name}.${sub}: ${nested.multiple ? 'multiple' : nested.kind} row fields cannot be filterable.`] : []),
        ...rowIndexProblems(`${name}.${sub}`, nested),
    ]);
}

// --- Rows ---------------------------------------------------------------------------------

/** A row of a rows field, as stored. */
export type Row = { readonly _id?: string; readonly [field: string]: unknown };

/** Rows with an `_id` on each, from `next` when missing; nested rows too. */
export function withRowIds(declaration: FieldDeclaration, value: unknown, next: () => string): unknown {
    if (declaration.kind !== 'rows' || !Array.isArray(value)) return value;
    const taken = new Set(value.map(row => (row as Row)?._id).filter((id): id is string => typeof id === 'string'));
    return value.map(row => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
        const entries = row as Row;
        let id = entries._id;
        while (typeof id !== 'string' || !ROW_ID.test(id)) { id = next(); if (taken.has(id)) id = undefined; }
        taken.add(id);
        const nested = Object.fromEntries(Object.entries(declaration.fields ?? {}).filter(([sub]) => entries[sub] !== undefined).map(([sub, inner]) => [sub, withRowIds(inner, entries[sub], next)]));
        return { ...entries, ...nested, _id: id };
    });
}

/** Paths of the indexed or unique row fields at any depth, as field names from the top-level rows field. */
export function indexedRowPaths(fields: { readonly [name: string]: FieldDeclaration }): string[][] {
    const paths: string[][] = [];
    const visit = (declaration: FieldDeclaration, path: readonly string[]) => {
        if (declaration.kind !== 'rows') return;
        for (const [sub, nested] of Object.entries(declaration.fields ?? {})) {
            const at = [...path, sub];
            if ((nested.index || nested.unique) && INDEXABLE_ROW_KINDS.has(nested.kind) && !nested.multiple) paths.push(at);
            visit(nested, at);
        }
    };
    for (const [name, declaration] of Object.entries(fields)) visit(declaration, [name]);
    return paths;
}

/** The indexed or unique row field a path such as `['team', 'links', 'kind']` names, or null. */
export function indexedRowField(fields: { readonly [name: string]: FieldDeclaration }, path: readonly string[]): FieldDeclaration | null {
    let declaration = fields[path[0]!];
    for (const name of path.slice(1)) {
        if (declaration?.kind !== 'rows' || !Object.hasOwn(declaration.fields ?? {}, name)) return null;
        declaration = declaration.fields![name];
    }
    return path.length > 1 && declaration && (declaration.index || declaration.unique) && INDEXABLE_ROW_KINDS.has(declaration.kind) && !declaration.multiple ? declaration : null;
}

/** The RomeDB array index path of a row field: `team.links.kind` steps into each row as `team.*.links.*.kind`. */
export function rowIndexPath(path: readonly string[]): string {
    return path.join('.*.');
}

/** Whether a rows field has a searchable field at any depth, so its text is kept beside the document. */
export function rowsSearchable(declaration: FieldDeclaration): boolean {
    return declaration.kind === 'rows' && Object.values(declaration.fields ?? {}).some(nested => nested.search === true || rowsSearchable(nested));
}

/** The text of a rows value's searchable fields, at any depth. */
export function rowsPlain(declaration: FieldDeclaration, value: unknown): string {
    if (declaration.kind !== 'rows' || !Array.isArray(value)) return '';
    const parts: string[] = [];
    for (const row of value) {
        if (!row || typeof row !== 'object') continue;
        for (const [sub, nested] of Object.entries(declaration.fields ?? {})) {
            const entry = (row as Row)[sub];
            if (nested.kind === 'rows') parts.push(rowsPlain(nested, entry));
            else if (nested.search && typeof entry === 'string' && entry.trim()) parts.push(entry.trim());
            else if (nested.search && Array.isArray(entry)) parts.push(...entry.filter((item): item is string => typeof item === 'string' && !!item.trim()).map(item => item.trim()));
        }
    }
    return parts.filter(Boolean).join('\n');
}

/** Whether a rows value repeats a value of a unique row field, at any depth. The first repeated path. */
export function rowUniqueProblem(name: string, declaration: FieldDeclaration, value: unknown): string | undefined {
    if (declaration.kind !== 'rows') return undefined;
    for (const [sub, nested] of Object.entries(declaration.fields ?? {})) {
        if (nested.unique) {
            const values = Array.isArray(value) ? value.map(row => (row as Row)?.[sub]).filter(entry => entry !== undefined && entry !== null && entry !== '') : [];
            if (new Set(values.map(entry => String(entry))).size !== values.length) return `${name}: ${nested.label ?? sub} must be different in every row.`;
        }
        if (nested.kind === 'rows' && Array.isArray(value)) {
            for (const row of value) { const problem = rowUniqueProblem(`${name}.${sub}`, nested, (row as Row)?.[sub]); if (problem) return problem; }
        }
    }
    return undefined;
}

/**
 * Problems in a target's meta values (terms, users, menu items) against its groups' fields:
 * unknown names, invalid values, missing required fields. The values come back with row IDs.
 */
export function metaProblems(fields: { readonly [name: string]: FieldDeclaration }, value: unknown, next: () => string): { errors: { [name: string]: string }; values: { [name: string]: unknown } } {
    const errors: { [name: string]: string } = {};
    const values: { [name: string]: unknown } = {};
    if (value === undefined || value === null) return { errors, values };
    if (typeof value !== 'object' || Array.isArray(value)) return { errors: { meta: 'must be an object of fields.' }, values };
    for (const [name, entry] of Object.entries(value as { [name: string]: unknown })) {
        const declaration = fields[name];
        if (!declaration) { errors[name] = 'is not a field here.'; continue; }
        if (entry === undefined || entry === null || entry === '') continue;
        const error = validateValue(name, declaration, entry);
        if (error) { errors[name] = error; continue; }
        values[name] = withRowIds(declaration, entry, next);
        const unique = rowUniqueProblem(name, declaration, values[name]);
        if (unique) errors[name] = unique.slice(name.length + 2);
    }
    for (const [name, declaration] of Object.entries(fields)) if (declaration.required && values[name] === undefined && !errors[name]) errors[name] = 'is required.';
    return { errors, values };
}

// --- Conditions ---------------------------------------------------------------------------

/** Entry values as conditions read them: text, numbers, yes or no and lists of text; the rest does not count. */
export function conditionValues(values: { readonly [name: string]: unknown }): FormValues {
    const result: { [name: string]: FormValue } = {};
    for (const [name, value] of Object.entries(values)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') result[name] = value;
        else if (Array.isArray(value) && value.every(entry => typeof entry === 'string')) result[name] = value as string[];
    }
    return result;
}

/** A hidden field's key: the block's ID at the top, `<repeater>=<row id>/…/<block id>` in a row. */
export function hiddenKey(rowPath: readonly { name: string; id: string }[], blockId: string): string {
    return [...rowPath.map(row => `${row.name}=${row.id}`), blockId].join('/');
}

/**
 * Which blocks of a group its conditions hide for these values, as `hiddenKey`s, and the
 * values with hidden fields cleared, rows included. A field in a row sees the row's values
 * over the rows above it over the top level; hidden fields count as empty, so conditions
 * that depend on them follow. Settles in a few rounds; a cycle stops at the last.
 */
export function fieldVisibility(blocks: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>, values: { readonly [name: string]: unknown }, scope: FormValues = {}): { hidden: ReadonlySet<string>; values: { [name: string]: unknown } } {
    const fieldCount = flattenBlocks(blocks).filter(block => types.get(block.type)?.field).length;
    let current: { [name: string]: unknown } = { ...values };
    let hidden = new Set<string>();
    for (let round = 0; round <= fieldCount; round++) {
        const next = new Set<string>();
        const detect = (list: readonly Block[], own: { readonly [name: string]: unknown }, visible: FormValues, rowPath: readonly { name: string; id: string }[], inside: boolean) => {
            for (const block of list) {
                const type = types.get(block.type);
                const off = inside || !conditionShows(block.when, visible);
                if (off) next.add(hiddenKey(rowPath, block._id));
                if (!block.children) continue;
                const name = type?.field && typeof block.data.name === 'string' ? block.data.name : '';
                if (type?.field?.kind === 'repeater' && name) {
                    for (const row of (Array.isArray(own[name]) ? own[name] : []) as unknown[]) {
                        if (!row || typeof row !== 'object') continue;
                        const entries = row as Row;
                        detect(block.children, entries, { ...visible, ...conditionValues(entries) }, [...rowPath, { name, id: typeof entries._id === 'string' ? entries._id : '' }], off);
                    }
                } else detect(block.children, own, visible, rowPath, off);
            }
        };
        detect(blocks, current, { ...scope, ...conditionValues(current) }, [], false);
        const cleared = clearHidden(blocks, types, values, next);
        const settled = next.size === hidden.size && [...next].every(key => hidden.has(key));
        hidden = next;
        current = cleared;
        if (settled) break;
    }
    return { hidden, values: current };
}

/** The values without the fields `hidden` names, rows included. */
export function clearHidden(blocks: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>, values: { readonly [name: string]: unknown }, hidden: ReadonlySet<string>): { [name: string]: unknown } {
    const clear = (list: readonly Block[], own: { [name: string]: unknown }, rowPath: readonly { name: string; id: string }[]) => {
        for (const block of list) {
            const type = types.get(block.type);
            const name = type?.field && typeof block.data.name === 'string' ? block.data.name : '';
            if (hidden.has(hiddenKey(rowPath, block._id))) { if (name) delete own[name]; continue; }
            if (!block.children) continue;
            if (type?.field?.kind === 'repeater' && name) {
                if (Array.isArray(own[name])) own[name] = (own[name] as unknown[]).map(row => {
                    if (!row || typeof row !== 'object') return row;
                    const copy: { [name: string]: unknown } = { ...(row as Row) };
                    clear(block.children!, copy, [...rowPath, { name, id: typeof copy._id === 'string' ? copy._id : '' }]);
                    return copy;
                });
            } else clear(block.children, own, rowPath);
        }
    };
    const result: { [name: string]: unknown } = { ...values };
    clear(blocks, result, []);
    return result;
}
