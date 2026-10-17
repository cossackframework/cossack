/**
 * The collection builder's model: field types as the builder offers them, and their
 * conversion to and from field declarations. Client-safe.
 */
import { field as fields, type CollectionDefinition, type FieldDeclaration } from '@cossackframework/cms';

export const FIELD_TYPES = [
    { type: 'text', label: 'Text', description: 'A single line, such as a subtitle or SKU.' },
    { type: 'textarea', label: 'Long text', description: 'Plain paragraphs.' },
    { type: 'markdown', label: 'Rich text', description: 'Markdown with a toolbar and preview.' },
    { type: 'number', label: 'Number', description: 'Prices, ratings and measurements.' },
    { type: 'integer', label: 'Whole number', description: 'Counts and positions.' },
    { type: 'boolean', label: 'Yes / no', description: 'A checkbox.' },
    { type: 'date', label: 'Date and time', description: 'Stored in UTC.' },
    { type: 'choice', label: 'Choice', description: 'One of a fixed list.' },
    { type: 'media', label: 'Image or file', description: 'One file from the media library.' },
    { type: 'gallery', label: 'Gallery', description: 'Several files from the media library.' },
    { type: 'reference', label: 'Reference', description: 'An entry of another collection.' },
    { type: 'list', label: 'List', description: 'Several lines of text.' },
    { type: 'blocks', label: 'Blocks', description: 'Content built from blocks, such as headings, images and buttons.' },
    { type: 'json', label: 'JSON', description: 'Structured data for developers.' },
] as const;

export type FieldType = (typeof FIELD_TYPES)[number]['type'];

/** A field as the builder edits it. */
export interface FieldDraft {
    /** Stable while the builder is open, even when an unsaved field's name follows its label. */
    key: string;
    name: string;
    label: string;
    type: FieldType;
    required: boolean;
    description: string;
    placement: '' | 'main' | 'sidebar';
    unique: boolean;
    search: boolean;
    /** Maximum length for text, or maximum value for numbers; '' for none. */
    max: string;
    min: string;
    /** Choice values, one per line. */
    choices: string;
    defaultValue: string;
    /** reference: the target collection name. */
    target: string;
    /** blocks: allowed block types; empty allows all. */
    blocks: string[];
    /** A core field of a built-in collection. */
    locked: boolean;
}

let keys = 0;
const draftKey = () => `field-${++keys}`;

export function emptyDraft(label: string, type: FieldType): FieldDraft {
    return { key: draftKey(), name: fieldName(label), label: label.trim(), type, required: false, description: '', placement: '', unique: false, search: false, max: '', min: '', choices: '', defaultValue: '', target: '', blocks: [], locked: false };
}

/** `Release date` → `releaseDate`. */
export function fieldName(label: string): string {
    const words = label.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
    const name = words.map((word, index) => index ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()).join('');
    return /^[a-z]/.test(name) ? name.slice(0, 40) : `field${name}`.slice(0, 40);
}

/** `Product Reviews` → `product_reviews`, a collection name. */
export function collectionName(label: string): string {
    return label.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'c$1').slice(0, 40);
}

export function typeOf(declaration: FieldDeclaration): FieldType {
    switch (declaration.kind) {
        case 'string': return declaration.media ? 'media' : 'text';
        case 'text': return declaration.format === 'markdown' ? 'markdown' : 'textarea';
        case 'number': return 'number';
        case 'integer': return 'integer';
        case 'boolean': return 'boolean';
        case 'datetime': return 'date';
        case 'enum': return 'choice';
        case 'reference': return 'reference';
        case 'list': return declaration.media ? 'gallery' : 'list';
        case 'blocks': return 'blocks';
        default: return 'json';
    }
}

export function draftOf(name: string, declaration: FieldDeclaration, locked = false): FieldDraft {
    const type = typeOf(declaration);
    return {
        key: `saved-${name}`, name, label: declaration.label ?? name, type, required: declaration.required === true, description: declaration.description ?? '',
        placement: declaration.placement ?? '', unique: declaration.unique === true, search: declaration.search === true,
        max: declaration.max === undefined || type === 'media' ? '' : String(declaration.max), min: declaration.min === undefined ? '' : String(declaration.min),
        choices: (declaration.values ?? []).join('\n'), defaultValue: declaration.default === undefined || declaration.default === null ? '' : String(declaration.default),
        target: declaration.target?.startsWith('cms/') ? declaration.target.slice(4) : declaration.target ?? '', blocks: [...(declaration.blocks ?? [])], locked,
    };
}

/** The declaration a draft describes. Problems are reported by the host when the collection is saved. */
export function declarationOf(draft: FieldDraft): FieldDeclaration {
    const common = {
        label: draft.label.trim() || draft.name,
        ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
        ...(draft.required ? { required: true } : {}),
        ...(draft.placement ? { placement: draft.placement } : {}),
    };
    const number = (text: string) => text.trim() === '' ? undefined : Number(text);
    const max = number(draft.max);
    const min = number(draft.min);
    const bounds = { ...(max !== undefined ? { max } : {}), ...(min !== undefined ? { min } : {}) };
    switch (draft.type) {
        case 'text': return fields.string({ ...common, ...(max !== undefined ? { max } : {}), ...(draft.unique ? { unique: true } : {}), ...(draft.search ? { search: true } : {}), ...(draft.defaultValue ? { default: draft.defaultValue } : {}) });
        case 'textarea': return fields.text({ ...common, ...(max !== undefined ? { max } : {}), ...(draft.search ? { search: true } : {}) });
        case 'markdown': return fields.text({ ...common, format: 'markdown', ...(max !== undefined ? { max } : {}), ...(draft.search ? { search: true } : {}) });
        case 'number': return fields.number({ ...common, ...bounds, nullable: !draft.required, ...(draft.defaultValue !== '' && Number.isFinite(Number(draft.defaultValue)) ? { default: Number(draft.defaultValue) } : {}) });
        case 'integer': return fields.integer({ ...common, ...bounds, nullable: !draft.required, ...(draft.defaultValue !== '' && Number.isSafeInteger(Number(draft.defaultValue)) ? { default: Number(draft.defaultValue) } : {}) });
        case 'boolean': return fields.boolean({ ...common, default: draft.defaultValue === 'true' });
        case 'date': return fields.datetime({ ...common, nullable: !draft.required });
        case 'choice': {
            const values = draft.choices.split('\n').map(value => value.trim()).filter(Boolean);
            return fields.enum(values, { ...common, nullable: !draft.required, ...(draft.defaultValue && values.includes(draft.defaultValue) ? { default: draft.defaultValue } : {}) });
        }
        case 'media': return fields.media({ ...common, nullable: !draft.required });
        case 'gallery': return { ...fields.list('string', common), media: true };
        case 'reference': return fields.reference(`cms/${draft.target}`, { ...common, nullable: !draft.required });
        case 'list': return fields.list('string', common);
        case 'blocks': return fields.blocks({ ...common, ...(draft.blocks.length ? { blocks: [...draft.blocks] } : {}) });
        default: return fields.json(common);
    }
}

/** The settings of a collection the builder edits, without its fields. */
export interface CollectionDraft {
    name: string;
    label: string;
    singular: string;
    description: string;
    icon: string;
    path: string;
    /** Entries are on the site. */
    public: boolean;
    slug: boolean;
    publishable: boolean;
    hierarchical: boolean;
    visibility: 'public' | 'private';
    /** Visitors can comment on entries. */
    comments: boolean;
    taxonomies: string[];
    builtin: boolean;
}

export function collectionDraft(definition: CollectionDefinition): CollectionDraft {
    return {
        name: definition.name, label: definition.label, singular: definition.singular, description: definition.description ?? '', icon: definition.icon ?? 'document-text',
        path: definition.path ?? '', public: definition.path !== null && definition.path !== undefined, slug: definition.slug !== false, publishable: definition.publishable !== false,
        hierarchical: definition.hierarchical === true, visibility: definition.visibility ?? 'private', comments: definition.comments === true, taxonomies: [...(definition.taxonomies ?? [])], builtin: definition.builtin === true,
    };
}

/** The fields with the one at `from` moved to position `to` among the others. */
export function moveField<T>(fields: readonly T[], from: number, to: number): T[] {
    const rest = fields.filter((_, index) => index !== from);
    rest.splice(Math.min(Math.max(to, 0), rest.length), 0, fields[from]!);
    return rest;
}

/** The definition a draft and its fields describe. */
export function definitionOf(draft: CollectionDraft, fieldDrafts: readonly FieldDraft[]): CollectionDefinition {
    return {
        name: draft.name, label: draft.label.trim(), singular: draft.singular.trim(), ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
        icon: draft.icon, path: draft.public ? draft.path.trim().replace(/^\/+|\/+$/g, '') : null,
        slug: draft.slug, publishable: draft.publishable, hierarchical: draft.hierarchical, ...(draft.publishable ? {} : { visibility: draft.visibility }), comments: draft.comments,
        taxonomies: [...draft.taxonomies],
        fields: Object.fromEntries(fieldDrafts.filter(entry => !entry.locked).map(entry => [entry.name, declarationOf(entry)])),
        // Built-in fields are not sent, so their place among the others is.
        fieldOrder: fieldDrafts.map(entry => entry.name),
    };
}
