import type { EditorLayout } from '@cossackframework/cms';
/**
 * The collection builder's model: field types as the picker offers them, names from labels,
 * and the definition a draft describes. Client-safe.
 */
import type { Block, CollectionDefinition, FieldDeclaration, SchemaType } from '@cossackframework/cms';

export const FIELD_TYPES = [
    { type: 'text', label: 'Single line', description: 'One line of text, such as a subtitle or SKU.' },
    { type: 'textarea', label: 'Long text', description: 'Plain paragraphs.' },
    { type: 'markdown', label: 'Rich text', description: 'Markdown with a toolbar and preview.' },
    { type: 'number', label: 'Number', description: 'Prices, ratings and measurements.' },
    { type: 'integer', label: 'Whole number', description: 'Counts and positions.' },
    { type: 'boolean', label: 'Yes / no', description: 'A checkbox.' },
    { type: 'date', label: 'Date and time', description: 'Stored in UTC.' },
    { type: 'choice', label: 'Choice', description: 'One of a fixed list.' },
    { type: 'media', label: 'Image or file', description: 'A file from the media library; a gallery with Multiple on.' },
    { type: 'reference', label: 'Reference', description: 'An entry of another collection.' },
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
    /** Entries are listed in the XML sitemap. */
    sitemap: boolean;
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
    /** Structured data: the schema.org type of entries and which fields fill its properties. */
    schemaType: SchemaType;
    schemaMap: Record<string, string>;
    /** Robots: entries and the archive kept out of search engines, links on entries not followed. */
    noindex: boolean;
    nofollow: boolean;
    archiveNoindex: boolean;
    /** Title and description templates; empty uses Settings → SEO. */
    seoTitle: string;
    seoDescription: string;
    archiveTitle: string;
}

export function collectionDraft(definition: CollectionDefinition): CollectionDraft {
    return {
        name: definition.name, label: definition.label, singular: definition.singular, description: definition.description ?? '', icon: definition.icon ?? 'document-text',
        path: definition.path ?? '', public: definition.path !== null && definition.path !== undefined, slug: definition.slug !== false, publishable: definition.publishable !== false,
        hierarchical: definition.hierarchical === true, visibility: definition.visibility ?? 'private', comments: definition.comments === true, sitemap: definition.sitemap !== false, taxonomies: [...(definition.taxonomies ?? [])], builtin: definition.builtin === true,
        content: Boolean(definition.features?.content), excerpt: definition.features?.excerpt === true, featuredImage: definition.features?.featuredImage === true, password: definition.features?.password === true, revisions: definition.features?.revisions !== false,
        templateLock: definition.templateLock ?? '',
        schemaType: definition.schema?.type ?? 'WebPage', schemaMap: { ...(definition.schema?.map ?? {}) },
        noindex: definition.robots?.noindex === true, nofollow: definition.robots?.nofollow === true, archiveNoindex: definition.robots?.archiveNoindex === true,
        seoTitle: definition.seoTemplates?.title ?? '', seoDescription: definition.seoTemplates?.description ?? '', archiveTitle: definition.seoTemplates?.archiveTitle ?? '',
    };
}

/** The definition a draft and its content template describe. Fields live in the groups attached to the collection. */
export function definitionOf(draft: CollectionDraft, template: readonly Block[] = [], editor?: EditorLayout): CollectionDefinition {
    const map = Object.fromEntries(Object.entries(draft.schemaMap).filter(([, name]) => name));
    return {
        name: draft.name, label: draft.label.trim(), singular: draft.singular.trim(), ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
        icon: draft.icon, path: draft.public ? draft.path.trim().replace(/^\/+|\/+$/g, '') : null,
        slug: draft.slug, publishable: draft.publishable, hierarchical: draft.hierarchical, ...(draft.publishable ? {} : { visibility: draft.visibility }), comments: draft.comments, sitemap: draft.sitemap,
        taxonomies: [...draft.taxonomies],
        features: { content: draft.content, excerpt: draft.excerpt, featuredImage: draft.featuredImage, password: draft.password === true, revisions: draft.revisions },
        fields: {},
        template: draft.content ? [...template] : [], ...(draft.content && draft.templateLock && template.length ? { templateLock: draft.templateLock } : {}),
        schema: { type: draft.schemaType, ...(Object.keys(map).length ? { map } : {}) },
        robots: { noindex: draft.noindex, nofollow: draft.nofollow, archiveNoindex: draft.archiveNoindex },
        seoTemplates: { title: draft.seoTitle.trim(), description: draft.seoDescription.trim(), archiveTitle: draft.archiveTitle.trim() },
        ...(editor ? { editor } : {}),
    };
}
