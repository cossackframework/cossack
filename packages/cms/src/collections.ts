/**
 * Collections: content types such as posts, pages and products, defined as data. Each is a
 * schemaless resource `cms/<name>` stored in its own document table; the host validates the
 * fields. Built-in collections keep their core fields and accept added ones.
 */
import { FIELD_NAME, field, fieldProblems, TAXONOMY_NAME, type FieldDeclaration } from './fields';
import { RESOURCE_NAME, type AccessRule, type ResourceDeclaration } from './resource';

/**
 * Entry states of a publishable collection. Pending entries wait for review; scheduled ones are
 * published when their publication time comes. Trash keeps an entry until it is deleted.
 */
export const CONTENT_STATUSES = ['draft', 'pending', 'scheduled', 'published', 'trash'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** A language code in URLs and entries: `en`, `pt-br`, `zh-hans`. */
export const LOCALE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/;

/** A language's own name, such as `Français` for `fr`. Client-safe: dashboards render it. */
export function languageName(code: string): string {
    try {
        const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
        return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
    } catch { return code; }
}

/** An entry's search and sharing settings; each falls back to the entry's own values. */
export const SEO_FIELDS = Object.freeze({
    title: field.string({ max: 200, label: 'SEO title' }),
    description: field.text({ max: 500, label: 'Meta description' }),
    image: field.media({ label: 'Social image' }),
    canonical: field.string({ max: 2000, pattern: '(?:https?://[^\\s]+|/[^\\s]*)?', label: 'Canonical URL' }),
    noindex: field.boolean({ label: 'Hide from search engines' }),
});

export interface CollectionDefinition {
    /** Lowercase name, such as `products`. The resource is `cms/<name>`. */
    readonly name: string;
    /** Plural label, such as `Products`. */
    readonly label: string;
    /** One entry, such as `Product`. */
    readonly singular: string;
    readonly description?: string;
    /** Solar icon name for navigation, such as `box`. */
    readonly icon?: string;
    /** Derive a unique slug from the title. Default true. */
    readonly slug?: boolean;
    /** Draft, published and trash states with a publication time. Default true. */
    readonly publishable?: boolean;
    /** Entries nest through `parent`. Default false. */
    readonly hierarchical?: boolean;
    /** Taxonomies whose terms entries can carry, such as `categories`. */
    readonly taxonomies?: readonly string[];
    /**
     * Public URL base: entries at `/<path>/<slug>`. `''` serves entries at the site root, as
     * WordPress's "Post name" permalinks do; root slugs stay unique across root collections.
     * Null or absent keeps them off the site.
     */
    readonly path?: string | null;
    /** Unpublishable collections: readable by anyone (`public`) or by permission (`private`, the default). */
    readonly visibility?: 'public' | 'private';
    /** Visitors can comment on published entries; each entry can close its comments. Default false. */
    readonly comments?: boolean;
    /** Fields besides the core ones (title, slug, status, publication time, parent and taxonomies). */
    readonly fields: { readonly [name: string]: FieldDeclaration };
    /**
     * The order of the fields, for built-in collections, whose module fields are not stored with
     * the added ones. Fields it does not name follow in their declared order.
     */
    readonly fieldOrder?: readonly string[];
    /** Shipped with a module: core settings and fields cannot change, but fields can be added. */
    readonly builtin?: boolean;
    /** The plugin that ships the collection. Its entries are on the site and in the dashboard only while the plugin is active. */
    readonly plugin?: string;
}

/** Field names the host derives from a definition. */
export const CORE_FIELDS = Object.freeze(['title', 'slug', 'status', 'publishedAt', 'parent', 'menuOrder', 'seo', 'locale', 'translationGroup', 'commentsOpen', 'template']);
/** A template an editor can choose for one entry: one of the active theme's `entry-*` templates. Empty for the default. */
export const ENTRY_TEMPLATE = 'entry-[a-z][a-z0-9_-]{0,73}';
const RESERVED = new Set(['media', 'users', 'roles', 'terms', 'settings', 'collections', 'taxonomies', 'blocks', 'plugins', 'schema', 'content', 'new']);
const PATH = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const ICON = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Problems in a collection definition; empty when valid. */
export function collectionProblems(definition: CollectionDefinition): string[] {
    const problems: string[] = [];
    if (typeof definition?.name !== 'string' || !RESOURCE_NAME.test(definition.name) || definition.name.includes('__')) problems.push('The name must be lowercase letters, digits and single underscores, starting with a letter.');
    else if (RESERVED.has(definition.name)) problems.push(`${definition.name} is reserved.`);
    for (const key of ['label', 'singular'] as const) {
        if (typeof definition?.[key] !== 'string' || !definition[key].trim() || definition[key].length > 60) problems.push(`The ${key === 'label' ? 'plural label' : 'singular label'} must be 1-60 characters.`);
    }
    if (definition.description !== undefined && (typeof definition.description !== 'string' || definition.description.length > 500)) problems.push('The description can be at most 500 characters.');
    if (definition.icon !== undefined && (typeof definition.icon !== 'string' || !ICON.test(definition.icon))) problems.push('The icon must be a Solar icon name.');
    if (definition.path !== undefined && definition.path !== null && definition.path !== '' && (typeof definition.path !== 'string' || !PATH.test(definition.path) || definition.path.length > 100)) problems.push('The URL path uses lowercase letters, digits, hyphens and slashes.');
    if (definition.visibility !== undefined && !['public', 'private'].includes(definition.visibility)) problems.push('Visibility is public or private.');
    if (definition.comments !== undefined && typeof definition.comments !== 'boolean') problems.push('Comments are on or off.');
    const taxonomies = definition.taxonomies ?? [];
    if (!Array.isArray(taxonomies) || taxonomies.length > 8 || taxonomies.some(name => typeof name !== 'string' || !TAXONOMY_NAME.test(name)) || new Set(taxonomies).size !== taxonomies.length) problems.push('Choose at most 8 distinct taxonomies.');
    const fields = Object.entries(definition.fields ?? {});
    if (fields.length > 32) problems.push('Add at most 32 fields.');
    if (definition.fieldOrder !== undefined && (!Array.isArray(definition.fieldOrder) || definition.fieldOrder.length > 64 || definition.fieldOrder.some(name => typeof name !== 'string' || !FIELD_NAME.test(name)))) problems.push('The field order names at most 64 fields.');
    const taken = new Set([...CORE_FIELDS, ...taxonomies]);
    for (const [name, declaration] of fields) {
        if (taken.has(name)) problems.push(`${name} is a core field of every collection.`);
        if (!FIELD_NAME.test(name)) problems.push(`Field ${name}: names start with a lowercase letter and use letters and digits.`);
        if (declaration?.kind === 'vector' || declaration?.kind === 'bigint') problems.push(`Field ${name}: ${declaration.kind} fields are not available in collections.`);
        if (declaration?.taxonomy) problems.push(`Field ${name}: choose taxonomies on the collection instead.`);
        problems.push(...fieldProblems(name, declaration ?? ({} as FieldDeclaration)).map(problem => problem.replace(/^field /, 'Field ')));
    }
    return problems;
}

/** The resource for a collection: core fields from the definition, then its own. */
export function collectionResource(definition: CollectionDefinition, labels: { readonly [taxonomy: string]: string } = {}): ResourceDeclaration {
    const id = `cms/${definition.name}`;
    const slug = definition.slug !== false;
    const publishable = definition.publishable !== false;
    const fields: { [name: string]: FieldDeclaration } = {
        title: field.string({ required: true, max: 200, search: true, label: 'Title' }),
        ...(slug ? { slug: field.slug('title', { required: true, label: 'Slug' }) } : {}),
        ...(publishable ? {
            status: field.enum(CONTENT_STATUSES, { required: true, default: 'draft', index: true, label: 'Status' }),
            publishedAt: field.datetime({ nullable: true, index: true, label: 'Published at' }),
        } : {}),
        ...(definition.hierarchical ? {
            parent: field.reference(id, { nullable: true, label: `Parent ${definition.singular.toLowerCase()}` }),
            menuOrder: field.integer({ default: 0, min: -1000, max: 1000, label: 'Order' }),
        } : {}),
        seo: field.group(SEO_FIELDS, { label: 'SEO' }),
        // The entry's language, and the group its translations share; see Settings → Languages.
        locale: field.string({ max: 16, nullable: true, index: true, pattern: LOCALE.source.slice(1, -1), label: 'Language' }),
        translationGroup: field.string({ max: 80, nullable: true, index: true, pattern: '[A-Za-z0-9_-]{1,80}', label: 'Translations' }),
        // New entries take Settings → Discussion's default; null reads as open.
        ...(definition.comments ? { commentsOpen: field.boolean({ nullable: true, label: 'Allow comments' }) } : {}),
        // Entries on the site can use another of the active theme's templates.
        ...(typeof definition.path === 'string' ? { template: field.string({ max: 80, nullable: true, pattern: `(?:${ENTRY_TEMPLATE})?`, label: 'Template' }) } : {}),
    };
    for (const taxonomy of definition.taxonomies ?? []) fields[taxonomy] = field.terms(taxonomy, { label: labels[taxonomy] ?? taxonomy });
    for (const [name, declaration] of Object.entries(definition.fields)) fields[name] = declaration;
    const read: AccessRule = publishable ? { any: [{ where: { status: 'published' } }, 'owner', { permission: `${id}:read` }] }
        : definition.visibility === 'public' ? 'public' : { any: ['owner', { permission: `${id}:read` }] };
    return {
        name: definition.name,
        owner: 'cms',
        label: definition.label,
        titleField: 'title',
        ownership: true,
        schemaless: true,
        fields,
        indexes: publishable ? [{ name: 'published', fields: ['status', 'publishedAt'] }] : [],
        access: {
            read,
            create: { permission: `${id}:create` },
            update: { any: ['owner', { permission: `${id}:update` }] },
            delete: { any: ['owner', { permission: `${id}:delete` }] },
        },
    };
}

/** The public URL of an entry: the collection's path, then its ancestors' slugs and its own. */
export function entryUrl(path: string | null | undefined, slugs: readonly string[]): string | null {
    if (path === null || path === undefined || !slugs.length || slugs.some(slug => !slug)) return null;
    return `/${[...(path ? [path] : []), ...slugs].join('/')}`;
}

/** Fields in the given order; fields it does not name follow in their own order. */
export function orderedFields<T>(fields: { readonly [name: string]: T }, order: readonly string[] = []): { [name: string]: T } {
    const result: { [name: string]: T } = {};
    for (const name of order) if (Object.hasOwn(fields, name)) result[name] = fields[name]!;
    for (const [name, value] of Object.entries(fields)) if (!Object.hasOwn(result, name)) result[name] = value;
    return result;
}

/**
 * A built-in collection with fields an administrator added, after the module's own unless
 * `fieldOrder` places them. Core settings and fields win.
 */
export function extendCollection(builtin: CollectionDefinition, stored: Partial<CollectionDefinition>): CollectionDefinition {
    const added = Object.fromEntries(Object.entries(stored.fields ?? {}).filter(([name]) => !Object.hasOwn(builtin.fields, name)));
    return {
        ...builtin,
        label: stored.label ?? builtin.label,
        singular: stored.singular ?? builtin.singular,
        ...(stored.description !== undefined ? { description: stored.description } : {}),
        ...(stored.icon !== undefined ? { icon: stored.icon } : {}),
        ...(stored.path !== undefined ? { path: builtin.path === '' ? '' : stored.path } : {}),
        ...(stored.comments !== undefined ? { comments: stored.comments } : {}),
        taxonomies: [...new Set([...(builtin.taxonomies ?? []), ...(stored.taxonomies ?? [])])],
        fields: orderedFields({ ...builtin.fields, ...added }, stored.fieldOrder),
        builtin: true,
    };
}

/** Built-in posts: published to the blog, with categories, tags and an author. */
export const posts: CollectionDefinition = {
    name: 'posts',
    label: 'Posts',
    singular: 'Post',
    icon: 'document-text',
    builtin: true,
    taxonomies: ['categories', 'tags'],
    path: 'posts',
    comments: true,
    fields: {
        excerpt: field.text({ max: 1000, label: 'Excerpt', description: 'A short summary for lists and feeds.' }),
        body: field.richText({ search: true, label: 'Body' }),
        sticky: field.boolean({ default: false, placement: 'sidebar', label: 'Stick to the top of the blog' }),
        featuredImage: field.media({ placement: 'sidebar', label: 'Featured image' }),
    },
};

/** Built-in pages: nested; a page's URL is its ancestors' slugs. */
export const pages: CollectionDefinition = {
    name: 'pages',
    label: 'Pages',
    singular: 'Page',
    icon: 'notebook',
    builtin: true,
    hierarchical: true,
    path: '',
    fields: {
        body: field.richText({ search: true, label: 'Body' }),
        excerpt: field.text({ max: 1000, label: 'Summary', description: 'Shown to search engines and in link previews.' }),
        featuredImage: field.media({ placement: 'sidebar', label: 'Featured image' }),
    },
};

/**
 * Built-in patterns: saved content to reuse. A synced pattern is inserted as a reference, so
 * editing it changes every entry that uses it; an unsynced one is inserted as a copy. Starter
 * patterns are offered as the first content of new entries.
 */
export const patterns: CollectionDefinition = {
    name: 'patterns',
    label: 'Patterns',
    singular: 'Pattern',
    icon: 'widget-add',
    builtin: true,
    slug: false,
    publishable: false,
    visibility: 'private',
    fields: {
        content: field.richText({ label: 'Content' }),
        synced: field.boolean({ default: true, placement: 'sidebar', label: 'Synced', description: 'Changes show everywhere the pattern is used.' }),
        starter: field.list('string', { placement: 'sidebar', label: 'Starting layout for', description: 'Collections whose new entries can start from this pattern.' }),
    },
};
