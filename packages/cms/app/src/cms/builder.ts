/**
 * The collection builder's model: field types as the picker offers them, names from labels,
 * and the definition a draft describes. Client-safe.
 */
import type { Block, CollectionDefinition, FieldDeclaration } from '@cossackframework/cms';

export const FIELD_TYPES = [
    { type: 'text', label: 'Single line', description: 'One line of text, such as a subtitle or SKU.' },
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
    /** The standard fields: blocks content, an excerpt and a featured image. */
    content: boolean;
    excerpt: boolean;
    featuredImage: boolean;
    /** A password visitors type to read an entry. */
    password: boolean;
    /** A revision of every write. */
    revisions: boolean;
    /** How far entries may change the content template: free, keep its blocks, or keep their order too. */
    templateLock: '' | 'insert' | 'all';
}

export function collectionDraft(definition: CollectionDefinition): CollectionDraft {
    return {
        name: definition.name, label: definition.label, singular: definition.singular, description: definition.description ?? '', icon: definition.icon ?? 'document-text',
        path: definition.path ?? '', public: definition.path !== null && definition.path !== undefined, slug: definition.slug !== false, publishable: definition.publishable !== false,
        hierarchical: definition.hierarchical === true, visibility: definition.visibility ?? 'private', comments: definition.comments === true, taxonomies: [...(definition.taxonomies ?? [])], builtin: definition.builtin === true,
        content: Boolean(definition.features?.content), excerpt: definition.features?.excerpt === true, featuredImage: definition.features?.featuredImage === true, password: definition.features?.password === true, revisions: definition.features?.revisions !== false,
        templateLock: definition.templateLock ?? '',
    };
}

/** The definition a draft and its content template describe. Fields live in the groups attached to the collection. */
export function definitionOf(draft: CollectionDraft, template: readonly Block[] = []): CollectionDefinition {
    return {
        name: draft.name, label: draft.label.trim(), singular: draft.singular.trim(), ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
        icon: draft.icon, path: draft.public ? draft.path.trim().replace(/^\/+|\/+$/g, '') : null,
        slug: draft.slug, publishable: draft.publishable, hierarchical: draft.hierarchical, ...(draft.publishable ? {} : { visibility: draft.visibility }), comments: draft.comments,
        taxonomies: [...draft.taxonomies],
        features: { content: draft.content, excerpt: draft.excerpt, featuredImage: draft.featuredImage, password: draft.password === true, revisions: draft.revisions },
        fields: {},
        template: draft.content ? [...template] : [], ...(draft.content && draft.templateLock && template.length ? { templateLock: draft.templateLock } : {}),
    };
}
