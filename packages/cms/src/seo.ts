/**
 * Search and answer-engine data, client-safe: the structured-data types a collection can map
 * its fields to, title and description templates, robots directives, author profile fields
 * and the JSON-LD graph of a site page. The app's `seo.ts` gathers the inputs on the server.
 */
import { field, type FieldDeclaration } from './fields';

/** Structured-data types a collection's entries can be; `none` emits no JSON-LD for them. */
export const SCHEMA_TYPES = ['Article', 'BlogPosting', 'NewsArticle', 'WebPage', 'Product', 'Event', 'Recipe', 'Person', 'Organization', 'LocalBusiness', 'VideoObject', 'none'] as const;
export type SchemaType = (typeof SCHEMA_TYPES)[number];

/** Types whose entries are articles: they carry an author, a publisher and dates. */
export const ARTICLE_TYPES: ReadonlySet<SchemaType> = new Set<SchemaType>(['Article', 'BlogPosting', 'NewsArticle']);

export const SCHEMA_TYPE_LABELS: { readonly [type in SchemaType]: string } = {
    Article: 'Article', BlogPosting: 'Blog post', NewsArticle: 'News article', WebPage: 'Web page', Product: 'Product', Event: 'Event', Recipe: 'Recipe',
    Person: 'Person', Organization: 'Organization', LocalBusiness: 'Local business', VideoObject: 'Video', none: 'No structured data',
};

export interface SchemaProperty {
    readonly name: string;
    readonly label: string;
    /** What the field should hold, shown as a hint. */
    readonly hint: string;
}

/** Properties of each type an entry's fields can fill; the title, description, image, dates and author come from the core fields. */
export const SCHEMA_PROPERTIES: { readonly [type in SchemaType]: readonly SchemaProperty[] } = {
    Article: [], BlogPosting: [], NewsArticle: [], WebPage: [], none: [],
    Product: [
        { name: 'price', label: 'Price', hint: 'A number.' }, { name: 'priceCurrency', label: 'Currency', hint: 'An ISO 4217 code such as USD.' },
        { name: 'sku', label: 'SKU', hint: 'Text.' }, { name: 'gtin', label: 'GTIN', hint: 'A barcode number.' }, { name: 'brand', label: 'Brand', hint: 'Text.' },
        { name: 'availability', label: 'Availability', hint: 'InStock, OutOfStock, PreOrder or a yes/no field (in stock).' },
    ],
    Event: [
        { name: 'startDate', label: 'Starts', hint: 'A date field.' }, { name: 'endDate', label: 'Ends', hint: 'A date field.' },
        { name: 'locationName', label: 'Venue', hint: 'Text.' }, { name: 'locationAddress', label: 'Address', hint: 'Text.' }, { name: 'organizer', label: 'Organizer', hint: 'Text.' },
        { name: 'price', label: 'Ticket price', hint: 'A number.' }, { name: 'priceCurrency', label: 'Currency', hint: 'An ISO 4217 code such as USD.' },
    ],
    Recipe: [
        { name: 'prepTime', label: 'Preparation time', hint: 'Minutes, as a number.' }, { name: 'cookTime', label: 'Cooking time', hint: 'Minutes, as a number.' },
        { name: 'recipeYield', label: 'Yield', hint: 'Text such as 4 servings.' }, { name: 'recipeCategory', label: 'Category', hint: 'Text such as Dessert.' }, { name: 'recipeCuisine', label: 'Cuisine', hint: 'Text such as Italian.' },
        { name: 'recipeIngredient', label: 'Ingredients', hint: 'A list, or text with one per line.' }, { name: 'recipeInstructions', label: 'Instructions', hint: 'A list, or text with one step per line.' },
        { name: 'calories', label: 'Calories', hint: 'A number per serving.' },
    ],
    Person: [
        { name: 'jobTitle', label: 'Job title', hint: 'Text.' }, { name: 'email', label: 'Email', hint: 'Text.' }, { name: 'telephone', label: 'Telephone', hint: 'Text.' },
        { name: 'url', label: 'Website', hint: 'A URL.' }, { name: 'sameAs', label: 'Profiles', hint: 'A list of URLs, or text with one per line.' }, { name: 'worksFor', label: 'Works for', hint: 'An organization name.' },
    ],
    Organization: [
        { name: 'url', label: 'Website', hint: 'A URL.' }, { name: 'email', label: 'Email', hint: 'Text.' }, { name: 'telephone', label: 'Telephone', hint: 'Text.' },
        { name: 'address', label: 'Address', hint: 'Text.' }, { name: 'sameAs', label: 'Profiles', hint: 'A list of URLs, or text with one per line.' },
    ],
    LocalBusiness: [
        { name: 'url', label: 'Website', hint: 'A URL.' }, { name: 'email', label: 'Email', hint: 'Text.' }, { name: 'telephone', label: 'Telephone', hint: 'Text.' },
        { name: 'address', label: 'Address', hint: 'Text.' }, { name: 'openingHours', label: 'Opening hours', hint: 'Text such as Mo-Fr 09:00-17:00, or a list.' },
        { name: 'priceRange', label: 'Price range', hint: 'Text such as $$.' }, { name: 'latitude', label: 'Latitude', hint: 'A number.' }, { name: 'longitude', label: 'Longitude', hint: 'A number.' },
    ],
    VideoObject: [
        { name: 'contentUrl', label: 'Video file', hint: 'A media field or URL.' }, { name: 'embedUrl', label: 'Embed URL', hint: 'A URL.' },
        { name: 'duration', label: 'Duration', hint: 'Seconds, as a number.' }, { name: 'uploadDate', label: 'Uploaded', hint: 'A date field; the publication date otherwise.' },
        { name: 'thumbnailUrl', label: 'Thumbnail', hint: 'A media field; the featured image otherwise.' },
    ],
};

/** How a collection's entries appear as structured data: the type and which fields fill its properties. */
export interface CollectionSchema {
    readonly type: SchemaType;
    /** Schema property → field name of the collection, for the type's `SCHEMA_PROPERTIES`. */
    readonly map?: { readonly [property: string]: string };
}

/** Robots directives of a collection's entries and archive. */
export interface CollectionRobots {
    /** Entries are kept out of search engines. */
    readonly noindex?: boolean;
    /** Links on entries are not followed. */
    readonly nofollow?: boolean;
    /** The archive is kept out of search engines. */
    readonly archiveNoindex?: boolean;
}

/** Templates for a collection's titles and descriptions; see `renderSeoTemplate`. Empty uses Settings → SEO. */
export interface CollectionSeoTemplates {
    readonly title?: string;
    readonly description?: string;
    readonly archiveTitle?: string;
}

/** Problems in a collection's `schema`, `robots` and `seoTemplates`; empty when valid. */
export function collectionSeoProblems(input: { schema?: unknown; robots?: unknown; seoTemplates?: unknown; fields?: readonly string[] }): string[] {
    const problems: string[] = [];
    const schema = input.schema as CollectionSchema | undefined;
    if (schema !== undefined) {
        if (!schema || typeof schema !== 'object' || Array.isArray(schema) || !(SCHEMA_TYPES as readonly string[]).includes(schema.type)) problems.push(`The structured data type is one of ${SCHEMA_TYPES.join(', ')}.`);
        else if (schema.map !== undefined) {
            const allowed = new Set(SCHEMA_PROPERTIES[schema.type].map(property => property.name));
            if (!schema.map || typeof schema.map !== 'object' || Array.isArray(schema.map)) problems.push('The structured data map is an object of properties to field names.');
            else for (const [property, name] of Object.entries(schema.map)) {
                if (!allowed.has(property)) problems.push(`${schema.type} has no property ${property} to map.`);
                else if (typeof name !== 'string' || !/^[a-z][A-Za-z0-9]{0,39}$/.test(name)) problems.push(`Property ${property} needs a field name.`);
                else if (input.fields && !input.fields.includes(name)) problems.push(`Property ${property} maps to ${name}, which is not a field.`);
            }
        }
    }
    const robots = input.robots as CollectionRobots | undefined;
    if (robots !== undefined && (!robots || typeof robots !== 'object' || Array.isArray(robots) || Object.entries(robots).some(([key, value]) => !['noindex', 'nofollow', 'archiveNoindex'].includes(key) || typeof value !== 'boolean'))) problems.push('Robots settings are noindex, nofollow and archiveNoindex, each on or off.');
    const templates = input.seoTemplates as CollectionSeoTemplates | undefined;
    if (templates !== undefined && (!templates || typeof templates !== 'object' || Array.isArray(templates) || Object.entries(templates).some(([key, value]) => !['title', 'description', 'archiveTitle'].includes(key) || typeof value !== 'string' || value.length > 300))) problems.push('SEO templates are title, description and archiveTitle, each at most 300 characters.');
    return problems;
}

// --- Templates ----------------------------------------------------------------------------

/** Variables a title or description template can use, as `%name%`. */
export const SEO_TEMPLATE_VARIABLES = Object.freeze({
    title: 'The entry, archive or term title', sep: 'The title separator', site: 'The site title', tagline: 'The tagline', excerpt: 'The entry\'s excerpt or summary',
    term: 'The term, on its archive', taxonomy: 'The taxonomy, on a term archive', author: 'The author', collection: 'The collection\'s plural label', page: 'The page number, from the second page on', date: 'The publication date',
});
export type SeoTemplateVariable = keyof typeof SEO_TEMPLATE_VARIABLES;

/** Settings → SEO's default templates. */
export const SEO_TEMPLATE_DEFAULTS = Object.freeze({
    home: '%site% %sep% %tagline%', entry: '%title% %sep% %site%', archive: '%title% %sep% %site%', term: '%term% %sep% %site%', author: '%author% %sep% %site%', search: 'Search results for “%title%” %sep% %site%',
    description: '%excerpt%',
});

/**
 * Render a template: `%var%` tokens are replaced, unknown ones removed, and separators left
 * dangling by empty values are dropped, so `%title% %sep% %site%` with no site title reads
 * as the title alone. A page number is appended when the template does not place it.
 */
export function renderSeoTemplate(template: string, variables: Partial<Record<SeoTemplateVariable, string | number | null | undefined>>): string {
    const sep = String(variables.sep ?? '–').trim() || '–';
    const page = Number(variables.page ?? 1);
    let text = template;
    if (page > 1 && !/%page%/.test(text)) text = `${text} %sep% Page %page%`;
    text = text.replace(/%([a-z]+)%/g, (_match, name: string) => {
        if (name === 'sep') return `\u0000`;
        if (name === 'page') return page > 1 ? String(page) : '';
        const value = variables[name as SeoTemplateVariable];
        return value === undefined || value === null ? '' : String(value).trim();
    });
    // Collapse separators around empty values: at the ends, or two in a row.
    const parts = text.split('\u0000').map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
    return parts.join(` ${sep} `);
}

// --- Robots -------------------------------------------------------------------------------

export type ImagePreview = 'none' | 'standard' | 'large';

export interface RobotsOptions {
    /** The whole site is hidden: `noindex, nofollow`. */
    readonly hidden?: boolean;
    readonly noindex?: boolean;
    readonly nofollow?: boolean;
    readonly nosnippet?: boolean;
    /** Characters of the page engines may quote; null or a negative number for no limit. */
    readonly maxSnippet?: number | null;
    readonly maxImagePreview?: ImagePreview;
    /** Bing: do not keep a cached copy, which also keeps the page out of Copilot's training. */
    readonly noarchive?: boolean;
}

/** The `robots` meta content, or empty when every engine default applies. */
export function robotsDirectives(options: RobotsOptions): string {
    if (options.hidden) return 'noindex, nofollow';
    const parts: string[] = [];
    if (options.noindex) parts.push('noindex');
    if (options.nofollow) parts.push('nofollow');
    if (options.nosnippet) parts.push('nosnippet');
    else if (typeof options.maxSnippet === 'number' && options.maxSnippet >= 0 && Number.isFinite(options.maxSnippet)) parts.push(`max-snippet:${Math.floor(options.maxSnippet)}`);
    if (options.noarchive) parts.push('noarchive');
    if (options.maxImagePreview && options.maxImagePreview !== 'standard') parts.push(`max-image-preview:${options.maxImagePreview}`);
    return parts.join(', ');
}

// --- Authors ------------------------------------------------------------------------------

/** A user's public profile, kept in `meta`: shown on author pages and as the `Person` of their entries. */
export const AUTHOR_FIELDS: { readonly [name: string]: FieldDeclaration } = Object.freeze({
    bio: field.text({ max: 1000, label: 'Bio', description: 'A few sentences about you, shown on your author page.' }),
    jobTitle: field.string({ max: 100, label: 'Job title' }),
    website: field.string({ max: 2000, pattern: '(?:https?://[^\\s]+)?', label: 'Website' }),
    profiles: field.text({ max: 2000, label: 'Profiles', description: 'Links to your profiles elsewhere, one per line: social accounts, Wikidata, an ORCID.' }),
});

/** `/author/<slug>`, with the language prefix. */
export function authorUrl(slug: string | null | undefined, prefix = ''): string | null {
    return slug ? `${prefix}/author/${slug}` : null;
}

/** URLs out of a text with one per line, http(s) only. */
export function urlList(text: unknown): string[] {
    if (Array.isArray(text)) return text.filter((entry): entry is string => typeof entry === 'string' && /^https?:\/\//.test(entry.trim())).map(entry => entry.trim());
    if (typeof text !== 'string') return [];
    return text.split(/\r?\n|,\s+/).map(line => line.trim()).filter(line => /^https?:\/\/[^\s]+$/.test(line));
}

// --- Structured data graph ----------------------------------------------------------------

export interface SchemaImage {
    /** Absolute URL. */
    readonly url: string;
    readonly width?: number | null;
    readonly height?: number | null;
    readonly alt?: string;
}

export interface SchemaSite {
    /** `https://example.com`, no trailing slash. */
    readonly origin: string;
    readonly name: string;
    readonly tagline: string;
    readonly locale: string;
    readonly representation: 'organization' | 'person';
    /** The organization's or person's name; the site title when empty. */
    readonly publisherName: string;
    readonly logo: SchemaImage | null;
    readonly sameAs: readonly string[];
}

export interface SchemaAuthor {
    readonly name: string;
    /** The author page, absolute; null when author pages are off. */
    readonly url: string | null;
    readonly image?: string | null;
    readonly description?: string;
    readonly jobTitle?: string;
    readonly website?: string | null;
    readonly sameAs?: readonly string[];
}

export interface SchemaBreadcrumb { readonly name: string; readonly url: string }

export interface SchemaPage {
    readonly kind: 'entry' | 'home' | 'archive' | 'term' | 'search' | 'author';
    /** Absolute. */
    readonly url: string;
    readonly title: string;
    readonly description: string;
    readonly locale: string;
    readonly image?: SchemaImage | null;
    /** ISO 8601. */
    readonly published?: string;
    readonly modified?: string;
    /** Ancestors, top first, the current page left out. */
    readonly breadcrumbs?: readonly SchemaBreadcrumb[];
    /** Entries: the collection's type and its mapped properties, already schema-shaped. */
    readonly type?: SchemaType;
    readonly properties?: { readonly [property: string]: unknown };
    readonly author?: SchemaAuthor | null;
    readonly keywords?: readonly string[];
    readonly section?: string;
    /** Things the page is about: terms with a `sameAs` URL. */
    readonly about?: readonly { readonly name: string; readonly sameAs?: string }[];
    /** Author pages: the person shown. */
    readonly profile?: SchemaAuthor;
    /** The entry's summary, as `abstract`. */
    readonly abstract?: string;
    /** Questions and answers blocks that asked for FAQPage markup. */
    readonly faq?: readonly { readonly question: string; readonly answer: string }[];
}

type Node = { [key: string]: unknown };

const ref = (id: string) => ({ '@id': id });
const clean = (node: Node): Node => Object.fromEntries(Object.entries(node).filter(([, value]) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length)));

function imageNode(id: string, image: SchemaImage): Node {
    return clean({ '@type': 'ImageObject', '@id': id, url: image.url, contentUrl: image.url, width: image.width ?? undefined, height: image.height ?? undefined, caption: image.alt });
}

function personNode(id: string, author: SchemaAuthor): Node {
    return clean({ '@type': 'Person', '@id': id, name: author.name, url: author.url ?? author.website ?? undefined, image: author.image ?? undefined, description: author.description, jobTitle: author.jobTitle, sameAs: [...(author.website && author.url ? [author.website] : []), ...(author.sameAs ?? [])] });
}

/**
 * The JSON-LD of a site page as one `@graph`: the publisher (Organization or Person), the
 * WebSite, the page (WebPage, CollectionPage, SearchResultsPage or ProfilePage) with its
 * image and breadcrumbs, and for entries the typed node: an Article with its author, or a
 * Product, Event, Recipe and the like with the collection's mapped properties.
 */
export function schemaGraph(site: SchemaSite, page: SchemaPage): { '@context': 'https://schema.org'; '@graph': Node[] } {
    const root = `${site.origin}/`;
    const publisherId = `${root}#${site.representation === 'person' ? 'person' : 'organization'}`;
    const websiteId = `${root}#website`;
    const pageId = `${page.url}#webpage`;
    const graph: Node[] = [];
    const publisherName = site.publisherName || site.name;
    graph.push(clean({
        '@type': site.representation === 'person' ? 'Person' : 'Organization', '@id': publisherId, name: publisherName, url: root,
        ...(site.logo ? { logo: ref(`${root}#logo`), image: ref(`${root}#logo`) } : {}), sameAs: site.sameAs,
    }));
    if (site.logo) graph.push(imageNode(`${root}#logo`, site.logo));
    graph.push(clean({ '@type': 'WebSite', '@id': websiteId, name: site.name, description: site.tagline, url: root, publisher: ref(publisherId), inLanguage: site.locale }));

    const type = page.kind === 'entry' ? page.type ?? 'WebPage' : undefined;
    if (type === 'none') return { '@context': 'https://schema.org', '@graph': graph };
    const pageType = page.kind === 'archive' || page.kind === 'term' ? 'CollectionPage' : page.kind === 'search' ? 'SearchResultsPage' : page.kind === 'author' || type === 'Person' ? 'ProfilePage' : 'WebPage';
    const imageId = page.image ? `${page.url}#primaryimage` : undefined;
    const breadcrumbId = page.breadcrumbs?.length ? `${page.url}#breadcrumb` : undefined;
    const entityId = type && type !== 'WebPage' ? `${page.url}#${ARTICLE_TYPES.has(type) ? 'article' : type.toLowerCase()}` : page.kind === 'author' && page.profile ? `${page.url}#person` : undefined;
    graph.push(clean({
        '@type': pageType, '@id': pageId, url: page.url, name: page.title, description: page.description, isPartOf: ref(websiteId), inLanguage: page.locale,
        datePublished: page.published, dateModified: page.modified, primaryImageOfPage: imageId ? ref(imageId) : undefined, image: imageId ? ref(imageId) : undefined,
        breadcrumb: breadcrumbId ? ref(breadcrumbId) : undefined, about: page.kind === 'home' ? ref(publisherId) : undefined,
        mainEntity: entityId && !ARTICLE_TYPES.has(type ?? 'none') ? ref(entityId) : undefined,
    }));
    if (imageId && page.image) graph.push(imageNode(imageId, page.image));
    if (breadcrumbId && page.breadcrumbs) {
        graph.push({ '@type': 'BreadcrumbList', '@id': breadcrumbId, itemListElement: [...page.breadcrumbs, { name: page.title, url: page.url }].map((crumb, index, all) => clean({ '@type': 'ListItem', position: index + 1, name: crumb.name, item: index === all.length - 1 ? undefined : crumb.url })) });
    }
    const authorId = page.author ? `${page.author.url ?? page.url}#${page.author.url ? 'person' : 'author'}` : undefined;
    const about = page.about?.map(thing => clean({ '@type': 'Thing', name: thing.name, sameAs: thing.sameAs }));
    if (type && ARTICLE_TYPES.has(type)) {
        graph.push(clean({
            '@type': type, '@id': entityId, headline: page.title, description: page.description, abstract: page.abstract, url: page.url, isPartOf: ref(pageId), mainEntityOfPage: ref(pageId), inLanguage: page.locale,
            datePublished: page.published, dateModified: page.modified, image: imageId ? ref(imageId) : undefined, author: authorId ? ref(authorId) : undefined, publisher: ref(publisherId),
            keywords: page.keywords, articleSection: page.section, about,
        }));
        if (authorId && page.author) graph.push(personNode(authorId, page.author));
    } else if (type && type !== 'WebPage' && entityId) {
        const properties = page.properties ?? {};
        graph.push(clean({
            '@type': type, '@id': entityId, name: page.title, description: page.description, url: page.url, mainEntityOfPage: ref(pageId), image: imageId ? ref(imageId) : undefined,
            ...(type === 'Recipe' || type === 'VideoObject' ? { datePublished: page.published, author: authorId ? ref(authorId) : undefined } : {}),
            ...(type === 'VideoObject' ? { uploadDate: properties.uploadDate ?? page.published, thumbnailUrl: properties.thumbnailUrl ?? page.image?.url } : {}),
            ...properties, about,
        }));
        if (authorId && page.author && (type === 'Recipe' || type === 'VideoObject')) graph.push(personNode(authorId, page.author));
    } else if (page.kind === 'author' && page.profile && entityId) {
        graph.push(personNode(entityId, page.profile));
    }
    if (page.faq?.length) {
        graph.push({ '@type': 'FAQPage', '@id': `${page.url}#faq`, isPartOf: ref(pageId), mainEntity: page.faq.map(item => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })) });
    }
    return { '@context': 'https://schema.org', '@graph': graph };
}

/**
 * Values of a type's mapped properties, schema-shaped, from an entry's fields: dates become
 * ISO strings, minutes durations, media URLs, line lists arrays, and prices an `Offer`.
 */
export function schemaProperties(schema: CollectionSchema, record: { readonly [field: string]: unknown }, fields: { readonly [name: string]: FieldDeclaration }, resolve: { mediaUrl(id: string): string | null; now?: number }): { [property: string]: unknown } {
    const map = schema.map ?? {};
    const allowed = new Set(SCHEMA_PROPERTIES[schema.type].map(property => property.name));
    const raw: { [property: string]: unknown } = {};
    for (const [property, name] of Object.entries(map)) {
        if (!allowed.has(property)) continue;
        const declaration = fields[name];
        const value = record[name];
        if (!declaration || value === undefined || value === null || value === '') continue;
        raw[property] = schemaValue(property, declaration, value, resolve);
    }
    const out: { [property: string]: unknown } = {};
    const offer = clean({ '@type': 'Offer', price: raw.price, priceCurrency: raw.priceCurrency, availability: availabilityOf(raw.availability) });
    for (const [property, value] of Object.entries(raw)) {
        if (['price', 'priceCurrency', 'availability'].includes(property)) continue;
        if (property === 'brand' || property === 'organizer' || property === 'worksFor') out[property] = { '@type': 'Organization', name: value };
        else if (property === 'locationName' || property === 'locationAddress') {
            out.location = { ...(out.location as Node | undefined), '@type': 'Place', ...(property === 'locationName' ? { name: value } : { address: value }) };
        } else if (property === 'latitude' || property === 'longitude') out.geo = { ...(out.geo as Node | undefined), '@type': 'GeoCoordinates', [property]: value };
        else if (property === 'calories') out.nutrition = { '@type': 'NutritionInformation', calories: `${value} calories` };
        else if (property === 'recipeInstructions' && Array.isArray(value)) out.recipeInstructions = value.map(step => ({ '@type': 'HowToStep', text: step }));
        else out[property] = value;
    }
    if (Object.keys(offer).length > 1 && (raw.price !== undefined || raw.availability !== undefined)) out.offers = offer;
    return out;
}

const AVAILABILITY = new Set(['InStock', 'OutOfStock', 'PreOrder', 'BackOrder', 'Discontinued', 'SoldOut', 'LimitedAvailability', 'OnlineOnly', 'InStoreOnly', 'PreSale']);

function availabilityOf(value: unknown): string | undefined {
    if (value === true) return 'https://schema.org/InStock';
    if (value === false) return 'https://schema.org/OutOfStock';
    if (typeof value !== 'string') return undefined;
    const name = value.replace(/^https?:\/\/schema\.org\//, '').replace(/\s+/g, '');
    const match = [...AVAILABILITY].find(entry => entry.toLowerCase() === name.toLowerCase());
    return match ? `https://schema.org/${match}` : undefined;
}

const MINUTES = new Set(['prepTime', 'cookTime', 'totalTime']);
const LISTS = new Set(['recipeIngredient', 'recipeInstructions', 'sameAs', 'openingHours']);

function schemaValue(property: string, declaration: FieldDeclaration, value: unknown, resolve: { mediaUrl(id: string): string | null }): unknown {
    if (declaration.media) {
        const ids = Array.isArray(value) ? value : [value];
        const urls = ids.map(id => resolve.mediaUrl(String(id))).filter((url): url is string => !!url);
        return urls.length > 1 ? urls : urls[0];
    }
    if (declaration.kind === 'datetime') return typeof value === 'number' ? new Date(value).toISOString() : undefined;
    if (MINUTES.has(property)) return typeof value === 'number' ? `PT${Math.round(value)}M` : typeof value === 'string' && /^PT/.test(value) ? value : undefined;
    if (property === 'duration') return typeof value === 'number' ? `PT${Math.round(value)}S` : typeof value === 'string' && /^PT/.test(value) ? value : undefined;
    if (LISTS.has(property)) {
        const items = Array.isArray(value) ? value.map(String) : String(value).split(/\r?\n/);
        return items.map(item => item.trim()).filter(Boolean);
    }
    if (declaration.kind === 'richtext' || declaration.kind === 'blocks' || declaration.kind === 'json') return undefined;
    return Array.isArray(value) ? value.map(String) : value;
}

// --- Crawlers -----------------------------------------------------------------------------

export interface CrawlerGroup {
    readonly id: 'search' | 'aiSearch' | 'aiTraining' | 'fetchers';
    readonly label: string;
    readonly description: string;
    /** User-agent tokens, as robots.txt names them. */
    readonly bots: readonly string[];
    /** False for agents that fetch a page a person asked for: robots.txt does not stop them. */
    readonly blockable: boolean;
}

/**
 * Crawlers by what they do with the page, for Settings → Crawlers. The lists ship with the
 * package and are revised with releases; a bot that is not listed is treated like a search
 * engine. `Google-Extended` is training *and* grounding in Gemini, so it sits with training.
 */
export const CRAWLER_GROUPS: readonly CrawlerGroup[] = Object.freeze([
    { id: 'search', label: 'Search engines', description: 'Index pages for search results, and feed the answers built on those results (AI Overviews, AI Mode, Copilot).', bots: ['Googlebot', 'Bingbot', 'Applebot', 'DuckDuckBot', 'YandexBot', 'Baiduspider', 'Slurp'], blockable: true },
    { id: 'aiSearch', label: 'AI search and answers', description: 'Index pages for AI assistants that cite sources: ChatGPT search, Claude, Perplexity.', bots: ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'DuckAssistBot'], blockable: true },
    { id: 'aiTraining', label: 'AI training', description: 'Collect pages to train models. Blocking them keeps the site out of future models; Google-Extended also stops grounding in Gemini.', bots: ['GPTBot', 'ClaudeBot', 'anthropic-ai', 'Google-Extended', 'CCBot', 'Applebot-Extended', 'Bytespider', 'meta-externalagent', 'Amazonbot', 'cohere-ai', 'Diffbot', 'omgili', 'PanguBot', 'Timpibot'], blockable: true },
    { id: 'fetchers', label: 'User-initiated fetchers', description: 'Fetch one page because a person asked an assistant about it. robots.txt does not apply to them; they count as visitors.', bots: ['ChatGPT-User', 'Claude-User', 'Perplexity-User', 'Meta-ExternalFetcher', 'Google-CloudVertexBot'], blockable: false },
]);

export interface CrawlerSettings {
    readonly allowSearch: boolean;
    readonly allowAiSearch: boolean;
    readonly allowAiTraining: boolean;
    /** Add Cloudflare's `Content-Signal` line stating the same preferences. */
    readonly contentSignals: boolean;
}

/** The user-agent groups robots.txt blocks: a `User-agent` line per bot, then `Disallow: /`. */
export function blockedCrawlerGroups(settings: CrawlerSettings): CrawlerGroup[] {
    return CRAWLER_GROUPS.filter(group => group.blockable && (group.id === 'search' ? !settings.allowSearch : group.id === 'aiSearch' ? !settings.allowAiSearch : group.id === 'aiTraining' ? !settings.allowAiTraining : false));
}

/**
 * robots.txt of the site: the application's private paths kept out, blocked crawler groups,
 * the optional Content-Signal preference, extra rules and the sitemap. Hidden sites get
 * `Disallow: /` alone.
 */
export function robotsTxtLines(input: { hidden: boolean; crawlers: CrawlerSettings; extra: string; sitemapUrl: string; disallow?: readonly string[] }): string[] {
    if (input.hidden) return ['User-agent: *', 'Disallow: /'];
    const lines = ['User-agent: *', ...(input.disallow ?? ['/dashboard/', '/api/', '/auth/', '/preview/', '/indexnow/']).map(path => `Disallow: ${path}`)];
    if (input.crawlers.contentSignals) {
        const yes = (value: boolean) => value ? 'yes' : 'no';
        lines.push(`Content-Signal: search=${yes(input.crawlers.allowSearch)}, ai-input=${yes(input.crawlers.allowAiSearch)}, ai-train=${yes(input.crawlers.allowAiTraining)}`);
    }
    for (const group of blockedCrawlerGroups(input.crawlers)) {
        lines.push('', `# ${group.label}`);
        for (const bot of group.bots) lines.push(`User-agent: ${bot}`);
        lines.push('Disallow: /');
    }
    const extra = input.extra.trim();
    if (extra) lines.push('', extra);
    lines.push('', `Sitemap: ${input.sitemapUrl}`);
    return lines;
}

/** Search engine crawlers that are not in `CRAWLER_GROUPS` (never blocked), recognised for visit counts. */
const SEARCH_AGENTS = ['Googlebot', 'Bingbot', 'bingbot', 'Applebot', 'DuckDuckBot', 'YandexBot', 'Baiduspider', 'Slurp', 'Google-InspectionTool', 'Storebot-Google', 'GoogleOther', 'AdsBot-Google'];

/** The crawler a user agent string names, with its group, or null for browsers and unknown agents. */
export function crawlerOf(userAgent: string): { agent: string; group: CrawlerGroup['id'] | 'search' } | null {
    if (!userAgent) return null;
    const lower = userAgent.toLowerCase();
    for (const group of CRAWLER_GROUPS) for (const bot of group.bots) if (lower.includes(bot.toLowerCase())) return { agent: bot, group: group.id };
    for (const bot of SEARCH_AGENTS) if (lower.includes(bot.toLowerCase())) return { agent: bot.replace(/^bingbot$/, 'Bingbot'), group: 'search' };
    return null;
}
