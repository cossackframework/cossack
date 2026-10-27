import { richTextProblem } from './richtext';

/**
 * Field kinds of a resource declaration. Each kind maps to one RomeDB field type and
 * CHECK, validates write input, and maps stored values to a JSON-safe public value.
 */

export type FieldKind =
    | 'string' | 'text' | 'enum' | 'integer' | 'bigint' | 'number' | 'boolean'
    | 'datetime' | 'reference' | 'json' | 'list' | 'vector' | 'blocks' | 'richtext' | 'rows';

export type ListItemKind = 'string' | 'integer' | 'number' | 'boolean';

export interface FieldDeclaration {
    readonly kind: FieldKind;
    /** Must be present on create. A required field cannot be added to existing records without a backfill step. */
    readonly required?: boolean;
    /** A present field may hold null. */
    readonly nullable?: boolean;
    /** Constant default for new records. */
    readonly default?: string | number | boolean | null;
    readonly label?: string;
    readonly description?: string;
    /** string/text: maximum length in characters; rows: the most rows. */
    readonly max?: number;
    /** string/text: minimum length; integer/number: minimum value; rows: the fewest rows. */
    readonly min?: number;
    /** enum: allowed values. */
    readonly values?: readonly string[];
    /** enum: labels for values, by value. */
    readonly choices?: { readonly [value: string]: string };
    /** string: regular expression checked on write by the host. */
    readonly pattern?: string;
    /** reference: target resource ID (`owner/name`). */
    readonly target?: string;
    /** list: item kind. */
    readonly items?: ListItemKind;
    /** vector: dimensions. */
    readonly dimensions?: number;
    /** Include in the resource's full-text index. */
    readonly search?: boolean;
    /** Enforce uniqueness with a unique index. */
    readonly unique?: boolean;
    /** Create a scalar index. */
    readonly index?: boolean;
    /** Field-level access: permissions needed to read or write the field. */
    readonly access?: { readonly read?: string; readonly write?: string };
    /** string: derive a URL slug from this field when the value is empty. Unique slugs get `-2`, `-3`, … */
    readonly slugFrom?: string;
    /** list of strings: IDs of terms in this taxonomy, checked on write. */
    readonly taxonomy?: string;
    /** string, or list of strings: IDs of ready media files, checked on write. */
    readonly media?: boolean;
    /** blocks, richtext: the block types allowed; all when omitted. */
    readonly blocks?: readonly string[];
    /** blocks: the field holds a form, so input blocks and conditions are allowed in it. */
    readonly form?: boolean;
    /** Where the dashboard editor shows the field. Default: by kind. */
    readonly placement?: 'main' | 'sidebar';
    /** text: how the dashboard edits and the site renders the value. */
    /** text: `markdown` for a short passage with formatting, `code` for source edited in a code editor. */
    readonly format?: 'plain' | 'markdown' | 'code';
    /** json: a group of declared subfields; the value is an object of them, each optional. rows: the fields of each row. */
    readonly fields?: { readonly [name: string]: FieldDeclaration };
    /**
     * The field is kept by the host from a path into a rows field: the distinct values at
     * `derived` across every row, as a list, so filters on rows seek through an array index.
     * Never written by clients and never returned.
     */
    readonly derived?: readonly string[];
}

/** A row's identity: 1-40 letters, digits, `_` or `-`, distinct within its list. */
export const ROW_ID = /^[A-Za-z0-9_-]{1,40}$/;
/** Rows a field holds at most, by default and at the limit. */
export const ROW_LIMITS = Object.freeze({ default: 200, max: 1000, depth: 8 });

type Options = Omit<FieldDeclaration, 'kind'>;

/** Field builders. Every option is data, so declarations serialize into plugin manifests. */
export const field = {
    string: (options: Options = {}): FieldDeclaration => ({ kind: 'string', max: 255, ...options }),
    text: (options: Options = {}): FieldDeclaration => ({ kind: 'text', max: 100_000, ...options }),
    enum: (values: readonly string[], options: Options = {}): FieldDeclaration => ({ kind: 'enum', values: [...values], ...options }),
    integer: (options: Options = {}): FieldDeclaration => ({ kind: 'integer', ...options }),
    bigint: (options: Omit<Options, 'default' | 'min' | 'max'> = {}): FieldDeclaration => ({ kind: 'bigint', ...options }),
    number: (options: Options = {}): FieldDeclaration => ({ kind: 'number', ...options }),
    boolean: (options: Options = {}): FieldDeclaration => ({ kind: 'boolean', ...options }),
    /** Unix milliseconds. */
    datetime: (options: Options = {}): FieldDeclaration => ({ kind: 'datetime', ...options }),
    reference: (target: string, options: Options = {}): FieldDeclaration => ({ kind: 'reference', target, ...options }),
    /** A JSON object. Values must be plain JSON. */
    json: (options: Omit<Options, 'default'> = {}): FieldDeclaration => ({ kind: 'json', ...options }),
    list: (items: ListItemKind, options: Omit<Options, 'default'> = {}): FieldDeclaration => ({ kind: 'list', items, ...options }),
    vector: (dimensions: number, options: Omit<Options, 'default'> = {}): FieldDeclaration => ({ kind: 'vector', dimensions, ...options }),
    /** A unique URL slug derived from another field when left empty. */
    slug: (from: string, options: Options = {}): FieldDeclaration => ({ kind: 'string', max: 200, pattern: SLUG_PATTERN, unique: true, slugFrom: from, ...options }),
    /** Term IDs of a taxonomy, such as `categories`. Indexed, so records can be listed by term. */
    terms: (taxonomy: string, options: Omit<Options, 'default'> = {}): FieldDeclaration => ({ kind: 'list', items: 'string', taxonomy, index: true, ...options }),
    /** A media file ID. */
    media: (options: Options = {}): FieldDeclaration => ({ kind: 'string', max: 80, media: true, nullable: true, ...options }),
    /** An ordered list of content blocks, optionally limited to some block types. */
    blocks: (options: Omit<Options, 'default'> = {}): FieldDeclaration => ({ kind: 'blocks', ...options }),
    /** A rich text document (ProseMirror JSON) edited in the WYSIWYG editor; `blocks` limits the blocks it can embed. */
    richText: (options: Omit<Options, 'default'> = {}): FieldDeclaration => ({ kind: 'richtext', ...options }),
    /**
     * An object of declared subfields, such as an entry's SEO settings. Subfields are scalars,
     * media or lists of strings; each is optional and validated like a field.
     */
    group: (fields: { readonly [name: string]: FieldDeclaration }, options: Omit<Options, 'default' | 'fields'> = {}): FieldDeclaration => ({ kind: 'json', fields, nullable: true, ...options }),
    /**
     * A list of rows, each an object of the declared fields with an `_id`, as a repeater: at
     * most `max` rows. Rows nest when a field is itself rows.
     */
    rows: (fields: { readonly [name: string]: FieldDeclaration }, options: Omit<Options, 'default' | 'fields'> = {}): FieldDeclaration => ({ kind: 'rows', fields, ...options }),
};

/** Kinds a group's subfields can have. */
const GROUP_KINDS = new Set<FieldKind>(['string', 'text', 'enum', 'integer', 'number', 'boolean', 'datetime', 'list']);
/** Kinds a row's fields can have: anything a value in a document can be, but the big or special ones. */
const ROW_KINDS = new Set<FieldKind>(['string', 'text', 'enum', 'integer', 'number', 'boolean', 'datetime', 'reference', 'json', 'list', 'rows']);

/** Lowercase letters and digits separated by single hyphens. */
export const SLUG_PATTERN = '[a-z0-9]+(?:-[a-z0-9]+)*';

/**
 * A URL slug: accents removed, lowercase ASCII letters and digits joined by single
 * hyphens, at most `max` characters. Empty when the text has no such characters.
 */
export function slugify(text: string, max = 200): string {
    const ascii = String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').replace(/ß/g, 'ss').replace(/[æÆ]/g, 'ae').replace(/[øØ]/g, 'o');
    const slug = ascii.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug.length <= max ? slug : slug.slice(0, max).replace(/-+[^-]*$/, '') || slug.slice(0, max);
}

export const FIELD_NAME = /^[a-z][a-zA-Z0-9]{0,62}$/;
/** A derived field's name: the row path's names joined by `__`. */
export const DERIVED_NAME = /^[a-z][a-zA-Z0-9]{0,62}(?:__[a-z][a-zA-Z0-9]{0,62})+$/;
export const TAXONOMY_NAME = /^[a-z][a-zA-Z0-9]{0,40}$/;
const ENUM_VALUE = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** Check a declaration's own consistency. Returns problems; empty when valid. */
export function fieldProblems(name: string, declaration: FieldDeclaration, depth = 0): string[] {
    const problems: string[] = [];
    const at = `field ${name}`;
    if (!(declaration?.derived ? DERIVED_NAME : FIELD_NAME).test(name)) problems.push(`${at}: names start with a lowercase letter and use letters and digits only.`);
    const kinds: FieldKind[] = ['string', 'text', 'enum', 'integer', 'bigint', 'number', 'boolean', 'datetime', 'reference', 'json', 'list', 'vector', 'blocks', 'richtext', 'rows'];
    if (!kinds.includes(declaration.kind)) return [...problems, `${at}: unknown kind ${String(declaration.kind)}.`];
    const { kind } = declaration;
    if (declaration.max !== undefined && (!Number.isSafeInteger(declaration.max) || declaration.max < 1)) problems.push(`${at}: max must be a positive integer.`);
    if (declaration.min !== undefined && !Number.isFinite(declaration.min)) problems.push(`${at}: min must be a finite number.`);
    if (kind === 'enum') {
        if (!declaration.values?.length || declaration.values.some(value => !ENUM_VALUE.test(value)) || new Set(declaration.values).size !== declaration.values.length) {
            problems.push(`${at}: enum values must be 1-64 distinct letters, digits, dots, hyphens or underscores.`);
        }
    }
    if (kind === 'reference' && (typeof declaration.target !== 'string' || !/^[a-z][a-z0-9-]*\/[a-z][a-z0-9_]*$/.test(declaration.target))) problems.push(`${at}: reference target must be a resource ID such as cms/posts.`);
    if (kind === 'list' && !['string', 'integer', 'number', 'boolean'].includes(declaration.items as string)) problems.push(`${at}: list items must be string, integer, number or boolean.`);
    if (kind === 'vector' && (!Number.isInteger(declaration.dimensions) || declaration.dimensions! < 1 || declaration.dimensions! > 4096)) problems.push(`${at}: vector dimensions must be 1..4096.`);
    if (declaration.pattern !== undefined) {
        if (kind !== 'string') problems.push(`${at}: pattern applies to string fields only.`);
        else try { new RegExp(declaration.pattern, 'u'); } catch { problems.push(`${at}: pattern is not a valid regular expression.`); }
    }
    // Rows are searched through their fields' own `search` flags.
    if (declaration.search && !['string', 'text', 'richtext', 'blocks'].includes(kind)) problems.push(`${at}: only string, text, rich text and blocks fields can be searched.`);
    if (declaration.unique && ['json', 'list', 'vector', 'text', 'blocks', 'richtext', 'rows'].includes(kind)) problems.push(`${at}: ${kind} fields cannot be indexed.`);
    // A list of strings or integers can have an array index; other kinds cannot be indexed.
    if (declaration.index && (['json', 'vector', 'text', 'blocks', 'richtext', 'rows'].includes(kind) || (kind === 'list' && !['string', 'integer'].includes(declaration.items as string)))) problems.push(`${at}: ${kind} fields cannot be indexed.`);
    if (declaration.derived !== undefined && (kind !== 'list' || !Array.isArray(declaration.derived) || declaration.derived.length < 2 || declaration.derived.some(part => !FIELD_NAME.test(part)))) problems.push(`${at}: derived names a path of two or more fields and applies to lists.`);
    if (declaration.blocks !== undefined && ((kind !== 'blocks' && kind !== 'richtext') || !Array.isArray(declaration.blocks) || declaration.blocks.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(name)))) problems.push(`${at}: blocks lists block type names and applies to blocks and rich text fields.`);
    if (declaration.form !== undefined && (kind !== 'blocks' || typeof declaration.form !== 'boolean')) problems.push(`${at}: form applies to blocks fields and is true or false.`);
    if (declaration.placement !== undefined && !['main', 'sidebar'].includes(declaration.placement)) problems.push(`${at}: placement is main or sidebar.`);
    if (declaration.slugFrom !== undefined && (kind !== 'string' || typeof declaration.slugFrom !== 'string' || !FIELD_NAME.test(declaration.slugFrom))) problems.push(`${at}: slugFrom applies to string fields and names another field.`);
    if (declaration.taxonomy !== undefined && (kind !== 'list' || declaration.items !== 'string' || !TAXONOMY_NAME.test(declaration.taxonomy))) problems.push(`${at}: taxonomy applies to lists of strings and names a taxonomy.`);
    if (declaration.media !== undefined && (!(kind === 'string' || (kind === 'list' && declaration.items === 'string')) || typeof declaration.media !== 'boolean')) problems.push(`${at}: media applies to string fields and lists of strings.`);
    if (declaration.format !== undefined && (kind !== 'text' || !['plain', 'markdown', 'code'].includes(declaration.format))) problems.push(`${at}: format applies to text fields and is plain, markdown or code.`);
    if (kind === 'rows') {
        const entries = declaration.fields && typeof declaration.fields === 'object' ? Object.entries(declaration.fields) : [];
        if (!entries.length || entries.length > 48) problems.push(`${at}: rows hold 1-48 fields.`);
        if (depth >= ROW_LIMITS.depth) problems.push(`${at}: rows nest at most ${ROW_LIMITS.depth} levels.`);
        if (declaration.max !== undefined && declaration.max > ROW_LIMITS.max) problems.push(`${at}: rows hold at most ${ROW_LIMITS.max} rows.`);
        if (declaration.min !== undefined && (!Number.isSafeInteger(declaration.min) || declaration.min < 0)) problems.push(`${at}: min rows must be a whole number.`);
        for (const [sub, nested] of entries) {
            if (!nested || !ROW_KINDS.has(nested.kind)) { problems.push(`${at}.${sub}: row fields cannot be blocks, rich text, vectors or big integers.`); continue; }
            // Indexes and search on a row field are derived by the host; uniqueness is within the entry.
            if (nested.slugFrom || nested.derived) problems.push(`${at}.${sub}: row fields cannot be derived.`);
            problems.push(...fieldProblems(sub, nested, depth + 1).map(problem => problem.replace(/^field /, `${at}.`)));
        }
    } else if (declaration.fields !== undefined) {
        const entries = declaration.fields && typeof declaration.fields === 'object' ? Object.entries(declaration.fields) : [];
        if (kind !== 'json' || !entries.length || entries.length > 16) problems.push(`${at}: fields groups 1-16 subfields in a json field.`);
        for (const [sub, nested] of entries) {
            if (!nested || !GROUP_KINDS.has(nested.kind) || (nested.kind === 'list' && nested.items !== 'string')) { problems.push(`${at}.${sub}: subfields are strings, text, choices, numbers, booleans, times or lists of strings.`); continue; }
            if (nested.unique || nested.index || nested.search || nested.slugFrom || nested.taxonomy || nested.required || nested.fields) problems.push(`${at}.${sub}: subfields cannot be required, indexed, searched or derived.`);
            problems.push(...fieldProblems(sub, nested).map(problem => problem.replace(/^field /, `${at}.`)));
        }
    }
    if (declaration.default !== undefined) {
        const error = validateValue(name, declaration, declaration.default);
        if (error) problems.push(`${at}: default ${error}`);
    }
    for (const key of ['read', 'write'] as const) {
        const permission = declaration.access?.[key];
        if (permission !== undefined && !/^[a-z][a-z0-9:._*-]{0,127}$/.test(permission)) problems.push(`${at}: access.${key} must be a permission name.`);
    }
    return problems;
}

/** RomeDB field type for a declaration. */
export function storageType(declaration: FieldDeclaration, references: (target: string) => string): string {
    switch (declaration.kind) {
        case 'string': case 'text': case 'enum': return 'string';
        case 'integer': case 'bigint': case 'datetime': return 'integer';
        case 'number': return 'number';
        case 'boolean': return 'boolean';
        case 'reference': return `record<${references(declaration.target!)}>`;
        case 'json': return 'object';
        case 'list': return `array<${declaration.items}>`;
        case 'vector': return `vector<${declaration.dimensions}>`;
        case 'blocks': case 'rows': return 'array<object>';
        case 'richtext': return 'object';
    }
}

/** Deterministic CHECK expression, or undefined. Strings are validated, never interpolated raw. */
export function storageCheck(name: string, declaration: FieldDeclaration): string | undefined {
    const checks: string[] = [];
    if ((declaration.kind === 'string' || declaration.kind === 'text') && declaration.max !== undefined) checks.push(`length(${name}) <= ${declaration.max}`);
    if ((declaration.kind === 'string' || declaration.kind === 'text') && declaration.min !== undefined) checks.push(`length(${name}) >= ${Math.trunc(declaration.min)}`);
    if (declaration.kind === 'enum') checks.push(`${name} IN (${declaration.values!.map(value => `'${value}'`).join(', ')})`);
    if ((declaration.kind === 'integer' || declaration.kind === 'datetime')) checks.push(`${name} >= ${declaration.min ?? -MAX_SAFE} AND ${name} <= ${declaration.max ?? MAX_SAFE}`);
    if (declaration.kind === 'number' && declaration.min !== undefined) checks.push(`${name} >= ${declaration.min}`);
    if (declaration.kind === 'number' && declaration.max !== undefined) checks.push(`${name} <= ${declaration.max}`);
    return checks.length ? checks.join(' AND ') : undefined;
}

/** Validate one input value. Returns an error message, or undefined when valid. */
export function validateValue(name: string, declaration: FieldDeclaration, value: unknown): string | undefined {
    if (value === null) return declaration.nullable ? undefined : 'cannot be null.';
    switch (declaration.kind) {
        case 'string': case 'text': {
            if (typeof value !== 'string') return 'must be text.';
            // Blank text does not fill a required field.
            if (declaration.required && !value.trim()) return 'is required.';
            if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) return 'must be well-formed text.';
            const length = [...value].length;
            if (declaration.max !== undefined && length > declaration.max) return `must be at most ${declaration.max} characters.`;
            if (declaration.min !== undefined && length < declaration.min) return `must be at least ${declaration.min} characters.`;
            if (declaration.pattern !== undefined && !new RegExp(`^(?:${declaration.pattern})$`, 'u').test(value)) return 'has an invalid format.';
            return undefined;
        }
        case 'enum': return typeof value === 'string' && declaration.values!.includes(value) ? undefined : `must be one of ${declaration.values!.join(', ')}.`;
        case 'integer': case 'datetime': {
            if (typeof value !== 'number' || !Number.isSafeInteger(value)) return 'must be a safe integer.';
            if (declaration.min !== undefined && value < declaration.min) return `must be at least ${declaration.min}.`;
            if (declaration.max !== undefined && value > declaration.max) return `must be at most ${declaration.max}.`;
            return undefined;
        }
        case 'bigint': {
            const text = typeof value === 'bigint' ? value.toString() : value;
            if (typeof text !== 'string' || !/^(?:0|-?[1-9][0-9]{0,18})$/.test(text)) return 'must be an int64 decimal string.';
            const integer = BigInt(text);
            return integer < -(1n << 63n) || integer >= (1n << 63n) ? 'is outside int64.' : undefined;
        }
        case 'number': {
            if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a finite number.';
            if (declaration.min !== undefined && value < declaration.min) return `must be at least ${declaration.min}.`;
            if (declaration.max !== undefined && value > declaration.max) return `must be at most ${declaration.max}.`;
            return undefined;
        }
        case 'boolean': return typeof value === 'boolean' ? undefined : 'must be true or false.';
        case 'reference': return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? undefined : 'must be a record ID.';
        case 'json': {
            if (!isJsonObject(value, 0)) return 'must be a JSON object.';
            if (!declaration.fields) return undefined;
            for (const [key, entry] of Object.entries(value as { [key: string]: unknown })) {
                const nested = declaration.fields[key];
                if (!nested) return `has no subfield ${key}.`;
                // A missing or null subfield is unset.
                const error = entry === null ? undefined : validateValue(key, nested, entry);
                if (error) return `${nested.label ?? key} ${error}`;
            }
            return undefined;
        }
        case 'list': {
            if (!Array.isArray(value) || value.length > 10_000) return 'must be a list of at most 10000 items.';
            const item: FieldDeclaration = { kind: declaration.items as FieldKind };
            return value.some(entry => entry === null || validateValue(name, item, entry) !== undefined) ? `items must be ${declaration.items} values.` : undefined;
        }
        case 'vector': return Array.isArray(value) && value.length === declaration.dimensions && value.every(entry => typeof entry === 'number' && Number.isFinite(entry) && Number.isFinite(Math.fround(entry)))
            ? undefined : `must be ${declaration.dimensions} finite numbers.`;
        case 'blocks': {
            const shape = blocksShapeProblem(value);
            if (shape) return shape;
            return (value as { data: unknown }[]).every(block => isJsonObject(block.data, 1)) ? undefined : 'block data must be plain JSON.';
        }
        case 'richtext': return richTextProblem(value) ?? (isJsonObject(value, 0) ? undefined : 'must be plain JSON.');
        case 'rows': {
            const max = declaration.max ?? ROW_LIMITS.default;
            if (!Array.isArray(value) || value.length > max) return `must be a list of at most ${max} rows.`;
            if (declaration.min !== undefined && value.length < declaration.min) return `needs at least ${declaration.min} ${declaration.min === 1 ? 'row' : 'rows'}.`;
            const ids = new Set<string>();
            for (const [index, row] of value.entries()) {
                if (!isJsonObject(row, 0)) return `row ${index + 1} must be an object.`;
                const entries = row as { [key: string]: unknown };
                if (entries._id !== undefined) {
                    if (typeof entries._id !== 'string' || !ROW_ID.test(entries._id) || ids.has(entries._id)) return `row ${index + 1} has an invalid or repeated _id.`;
                    ids.add(entries._id);
                }
                for (const [key, nested] of Object.entries(declaration.fields ?? {})) {
                    const entry = entries[key];
                    if (entry === undefined || entry === null || entry === '') {
                        if (nested.required) return `row ${index + 1}: ${nested.label ?? key} is required.`;
                        continue;
                    }
                    const error = validateValue(key, nested, entry);
                    if (error) return `row ${index + 1}: ${nested.label ?? key} ${error}`;
                }
                for (const key of Object.keys(entries)) if (key !== '_id' && !Object.hasOwn(declaration.fields ?? {}, key)) return `row ${index + 1} has no field ${key}.`;
            }
            return undefined;
        }
    }
}

export { blocksShapeProblem } from './block-shape';
import { blocksShapeProblem } from './block-shape';

function isJsonObject(value: unknown, depth: number): boolean {
    if (depth > 32 || value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
    return Object.values(value).every(entry => isJsonValue(entry, depth + 1));
}

function isJsonValue(value: unknown, depth: number): boolean {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    // Integral numbers are stored as int64; unsafe ones would lose precision.
    if (typeof value === 'number') return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
    if (Array.isArray(value)) return depth <= 32 && value.every(entry => isJsonValue(entry, depth + 1));
    return isJsonObject(value, depth);
}
