/**
 * SEO data of site pages: templated titles and descriptions, canonical URLs, social images,
 * robots directives, language alternates and one JSON-LD graph (publisher, site, page,
 * breadcrumbs, article or typed entity, author). Server-only; the page keeps the result in
 * state and `seoHead()` turns it into tags.
 */
import type { Context } from 'hono';
import {
    ARTICLE_TYPES, authorUrl, mediaUrl, renderSeoTemplate, robotsDirectives, schemaGraph, schemaProperties, SCHEMA_PROPERTIES, TITLE_SEPARATORS, urlList,
    type Block, type CollectionDefinition, type EntryView, type LanguageLink, type RecordShape, type SchemaAuthor, type SchemaBreadcrumb, type SchemaImage, type SchemaPage, type SchemaSite, type SiteSettings, type TermShape,
} from '@cossackframework/cms';
import type { CmsFile, CmsHost, CmsUser } from '@cossackframework/cms/server';
import type { SeoView } from './seo-head';
import { isProtected, localePrefix } from './site';

/** The site's address: `APP_URL` when set, otherwise the request's origin. */
export function siteOrigin(c: Context): string {
    const configured = env('APP_URL', '');
    return (configured || new URL(c.req.url).origin).replace(/\/+$/, '');
}

function absolute(origin: string, url: string): string {
    return !url ? '' : /^https?:\/\//.test(url) ? url : `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

function separator(settings: SiteSettings): string {
    return TITLE_SEPARATORS[settings['seo.titleSeparator']] ?? '–';
}

function alternates(origin: string, links: readonly LanguageLink[]): SeoView['alternates'] {
    if (!links.length) return [];
    const fallback = links.find(link => link.code === links[0]!.code)!;
    return [...links.map(link => ({ hreflang: link.code, href: absolute(origin, link.url) })), { hreflang: 'x-default', href: absolute(origin, fallback.url) }];
}

/** An image for sharing and structured data: a media file, or a URL from the settings. */
function imageOf(origin: string, file: CmsFile | null | undefined, fallback: string): SchemaImage | null {
    if (file && file.contentType.startsWith('image/')) return { url: absolute(origin, mediaUrl(file)), width: file.width, height: file.height, alt: file.alt };
    return fallback ? { url: absolute(origin, fallback) } : null;
}

/** The media file an entry's SEO box or featured image names, if any. */
async function fileOf(cms: CmsHost, id: unknown): Promise<CmsFile | null> {
    return typeof id === 'string' && id && cms.files ? cms.files.get(id) : null;
}

/** What the graph says about the site: who publishes it, with logo and profiles. */
async function schemaSite(cms: CmsHost, origin: string, settings: SiteSettings, locale: string): Promise<SchemaSite> {
    const logo = settings['seo.logo'];
    let image: SchemaImage | null = logo ? { url: absolute(origin, logo) } : null;
    const match = /^\/media\/([^/]+)\//.exec(logo);
    if (match && cms.files) image = imageOf(origin, await cms.files.get(match[1]!), logo);
    return {
        origin, name: settings['general.siteTitle'], tagline: settings['general.tagline'], locale, representation: settings['seo.representation'],
        publisherName: settings['seo.publisherName'], logo: image, sameAs: urlList(settings['seo.sameAs']),
    };
}

/** An author as structured data: the owner's profile, linked to their page when author pages are on. */
function schemaAuthor(origin: string, user: CmsUser | undefined, settings: SiteSettings, prefix: string): SchemaAuthor | null {
    if (!user) return null;
    const meta = user.meta;
    const page = settings['seo.authorPages'] ? authorUrl(user.slug, prefix) : null;
    return {
        name: user.name, url: page ? absolute(origin, page) : null, image: user.avatar ? absolute(origin, user.avatar) : null,
        description: typeof meta.bio === 'string' ? meta.bio : '', jobTitle: typeof meta.jobTitle === 'string' ? meta.jobTitle : '',
        website: typeof meta.website === 'string' && /^https?:\/\//.test(meta.website) ? meta.website : null, sameAs: urlList(meta.profiles),
    };
}

/** Questions and answers blocks of an entry that asked for FAQPage markup. */
function faqOf(record: RecordShape): { question: string; answer: string }[] {
    const found: { question: string; answer: string }[] = [];
    const visit = (blocks: readonly Block[]) => {
        for (const block of blocks) {
            if (block.type === 'core/faq' && block.data.schema === true) {
                for (const item of block.children ?? []) if (item.type === 'core/faq-item' && typeof item.data.question === 'string' && typeof item.data.answer === 'string') found.push({ question: item.data.question, answer: item.data.answer });
            }
            if (block.children) visit(block.children);
        }
    };
    for (const value of Object.values(record)) if (Array.isArray(value) && value.every(entry => entry && typeof entry === 'object' && 'type' in entry)) visit(value as Block[]);
    return found;
}

/** Shared head data for any page kind. */
function base(origin: string, settings: SiteSettings, input: { title: string; ogTitle: string; ogDescription?: string; description: string; url: string; image: SchemaImage | null; robots: string; type: 'website' | 'article' | 'profile'; locale: string; links: readonly LanguageLink[]; graph: object | null; published?: string; modified?: string; markdownUrl?: string }): SeoView {
    return {
        title: input.title, ogTitle: input.ogTitle, ogDescription: input.ogDescription ?? input.description, description: input.description, canonical: input.url, image: input.image?.url ?? '', imageWidth: input.image?.width ?? null, imageHeight: input.image?.height ?? null, imageAlt: input.image?.alt ?? '',
        robots: input.robots, type: input.type, siteName: settings['general.siteTitle'], locale: input.locale, twitterSite: settings['seo.twitter'] ? `@${settings['seo.twitter'].replace(/^@/, '')}` : '',
        publishedTime: input.published ?? '', modifiedTime: input.modified ?? '', alternates: alternates(origin, input.links), jsonLd: input.graph ? JSON.stringify(input.graph).replace(/</g, '\\u003c') : '', markdownUrl: input.markdownUrl ?? '',
    };
}

/** Directives shared by every page: the site hidden, and the image preview size. */
function siteRobots(settings: SiteSettings) {
    return { hidden: settings['reading.discourageSearchEngines'], maxImagePreview: settings['seo.maxImagePreview'] };
}

/** Breadcrumbs of an entry: home, the collection's archive, then its ancestors; the entry itself is added by the graph. */
async function breadcrumbs(cms: CmsHost, origin: string, collection: CollectionDefinition, record: RecordShape, locale: string, prefix: string): Promise<SchemaBreadcrumb[]> {
    const crumbs: SchemaBreadcrumb[] = [{ name: __('Home'), url: absolute(origin, prefix || '/') }];
    const archive = collection.hierarchical ? null : await cms.archiveUrl(collection, locale).catch(() => null);
    if (archive && archive !== (prefix || '/')) crumbs.push({ name: collection.label, url: absolute(origin, archive) });
    if (collection.hierarchical) for (const ancestor of await ancestors(cms, collection, record)) crumbs.push({ name: ancestor.name, url: absolute(origin, ancestor.url) });
    return crumbs;
}

/** Ancestors of a nested entry, top first. */
async function ancestors(cms: CmsHost, collection: CollectionDefinition, record: RecordShape): Promise<{ name: string; url: string }[]> {
    const chain: RecordShape[] = [];
    let parent = typeof record.parent === 'string' ? record.parent : null;
    for (let depth = 0; parent && depth < 8; depth++) {
        const found = (await cms.resource(`cms/${collection.name}`).getMany([parent], { principal: { kind: 'anonymous' } })).get(parent);
        if (!found) break;
        chain.unshift(found);
        parent = typeof found.parent === 'string' ? found.parent : null;
    }
    const urls = await cms.entryUrls(collection, chain);
    return chain.flatMap(entry => urls.get(entry.id) ? [{ name: String(entry.title ?? ''), url: urls.get(entry.id)! }] : []);
}

/** The collection's mapped schema properties of a record, media resolved to absolute URLs. */
async function mappedProperties(cms: CmsHost, origin: string, collection: CollectionDefinition, record: RecordShape): Promise<{ [property: string]: unknown }> {
    const schema = collection.schema;
    if (!schema || !schema.map || !SCHEMA_PROPERTIES[schema.type].length) return {};
    const fields = cms.resourceById(`cms/${collection.name}`).fields;
    const mediaIds = Object.values(schema.map).flatMap(name => fields[name]?.media ? (Array.isArray(record[name]) ? record[name] as string[] : typeof record[name] === 'string' ? [record[name] as string] : []) : []);
    const files = cms.files && mediaIds.length ? await cms.files.getMany(mediaIds) : new Map<string, CmsFile>();
    return schemaProperties(schema, record, fields, { mediaUrl: id => { const file = files.get(id); return file ? absolute(origin, mediaUrl(file)) : null; } });
}

/** The terms of an entry as `about` things: each with its `sameAs` URL when the term's meta has one. */
async function aboutTerms(cms: CmsHost, collection: CollectionDefinition, record: RecordShape): Promise<{ name: string; sameAs?: string }[]> {
    const ids = (collection.taxonomies ?? []).flatMap(name => Array.isArray(record[name]) ? record[name] as string[] : []);
    if (!ids.length) return [];
    const terms = await cms.taxonomies.getMany(ids);
    return [...terms.values()].map((term: TermShape) => ({ name: term.name, ...(typeof term.meta.sameAs === 'string' && /^https?:\/\//.test(term.meta.sameAs) ? { sameAs: term.meta.sameAs } : {}) }));
}

/** An entry page: its SEO box first, then the collection's and the site's templates and the entry's own values. */
export async function entrySeo(cms: CmsHost, c: Context, collection: CollectionDefinition, record: RecordShape, view: EntryView, links: readonly LanguageLink[]): Promise<SeoView> {
    const settings = await cms.settings.all();
    const origin = siteOrigin(c);
    const languages = await cms.languages();
    const prefix = localePrefix(languages, view.locale);
    const sep = separator(settings);
    const seo = (record.seo ?? {}) as { title?: string; description?: string; image?: string | null; canonical?: string; noindex?: boolean; nosnippet?: boolean; maxSnippet?: number | null; noarchive?: boolean; socialTitle?: string; socialDescription?: string };
    const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
    const url = absolute(origin, seo.canonical || view.url || '');
    const type = collection.schema?.type ?? 'WebPage';
    const article = ARTICLE_TYPES.has(type);
    const published = typeof record.publishedAt === 'number' ? new Date(record.publishedAt).toISOString() : '';
    const modified = new Date(record.updatedAt).toISOString();
    const owner = record.owner ? (await cms.users.getMany([record.owner])).get(record.owner) : undefined;
    const author = schemaAuthor(origin, owner, settings, prefix);
    const variables = { title: view.title, sep, site: settings['general.siteTitle'], tagline: settings['general.tagline'], excerpt: seo.description || summary || view.excerpt, author: author?.name ?? '', collection: collection.label, date: view.date };
    const title = renderSeoTemplate(collection.seoTemplates?.title || settings['seo.entryTitle'], { ...variables, title: seo.title || view.title });
    const description = seo.description || renderSeoTemplate(collection.seoTemplates?.description || settings['seo.entryDescription'], variables);
    const image = imageOf(origin, await fileOf(cms, seo.image), '') ?? (view.image ? { url: absolute(origin, view.image.url), width: view.image.width, height: view.image.height, alt: view.image.alt } : imageOf(origin, null, settings['seo.defaultImage']));
    const robots = robotsDirectives({ ...siteRobots(settings), noindex: seo.noindex === true || collection.robots?.noindex === true, nofollow: collection.robots?.nofollow === true, nosnippet: seo.nosnippet === true, maxSnippet: seo.maxSnippet ?? null, noarchive: seo.noarchive === true });
    const page: SchemaPage = {
        kind: 'entry', url, title: seo.title || view.title, description, locale: view.locale, image, published, modified, type,
        breadcrumbs: type === 'none' ? [] : await breadcrumbs(cms, origin, collection, record, view.locale, prefix),
        properties: await mappedProperties(cms, origin, collection, record), author, about: type === 'none' ? [] : await aboutTerms(cms, collection, record),
        keywords: view.terms.flatMap(group => group.terms.map(term => term.name)), section: view.terms[0]?.terms[0]?.name ?? '', abstract: summary, faq: type === 'none' ? [] : faqOf(record),
    };
    return base(origin, settings, { title, ogTitle: seo.socialTitle || seo.title || view.title, ogDescription: seo.socialDescription || description, description, url, image, robots, type: article ? 'article' : type === 'Person' ? 'profile' : 'website', locale: view.locale, links, graph: schemaGraph(await schemaSite(cms, origin, settings, view.locale), page), published: article ? published : '', modified: article ? modified : '', markdownUrl: settings['seo.markdown'] && view.url && !isProtected(record) ? `${absolute(origin, view.url)}?format=md` : '' });
}

/** A list page: an archive, a term archive or search results. */
export async function listSeo(cms: CmsHost, c: Context, input: { kind: 'archive' | 'term' | 'search'; title: string; description: string; url: string; locale: string; links: readonly LanguageLink[]; page?: number; noindex?: boolean; nofollow?: boolean; collection?: CollectionDefinition | null; term?: TermShape; taxonomy?: string; template?: string }): Promise<SeoView> {
    const settings = await cms.settings.all();
    const origin = siteOrigin(c);
    const sep = separator(settings);
    const page = input.page ?? 1;
    const url = absolute(origin, page > 1 ? `${input.url}?page=${page}` : input.url);
    const variables = { title: input.title, sep, site: settings['general.siteTitle'], tagline: settings['general.tagline'], term: input.term?.name ?? '', taxonomy: input.taxonomy ?? '', collection: input.collection?.label ?? '', page };
    const template = input.template || (input.kind === 'term' ? settings['seo.termTitle'] : input.kind === 'search' ? '%title% %sep% %site%' : input.collection?.seoTemplates?.archiveTitle || settings['seo.archiveTitle']);
    const title = renderSeoTemplate(template, variables);
    const description = input.description || (input.kind === 'archive' && page === 1 ? settings['general.tagline'] : '');
    const image = imageOf(origin, null, settings['seo.defaultImage']);
    const robots = robotsDirectives({ ...siteRobots(settings), noindex: input.noindex === true, nofollow: input.nofollow === true });
    const graph = schemaGraph(await schemaSite(cms, origin, settings, input.locale), { kind: input.kind, url, title: renderSeoTemplate('%title%', variables), description, locale: input.locale, image, breadcrumbs: [{ name: __('Home'), url: absolute(origin, '/') }] });
    return base(origin, settings, { title, ogTitle: renderSeoTemplate('%title%', variables), description, url, image, robots, type: 'website', locale: input.locale, links: input.links, graph });
}

/** An author's page: their profile as a `ProfilePage`. */
export async function authorSeo(cms: CmsHost, c: Context, input: { user: CmsUser; url: string; locale: string; links: readonly LanguageLink[]; page?: number }): Promise<SeoView> {
    const settings = await cms.settings.all();
    const origin = siteOrigin(c);
    const languages = await cms.languages();
    const page = input.page ?? 1;
    const url = absolute(origin, page > 1 ? `${input.url}?page=${page}` : input.url);
    const profile = schemaAuthor(origin, input.user, settings, localePrefix(languages, input.locale))!;
    const title = renderSeoTemplate(settings['seo.authorTitle'], { author: input.user.name, sep: separator(settings), site: settings['general.siteTitle'], tagline: settings['general.tagline'], page });
    const description = profile.description || `${__('Entries by')} ${input.user.name}`;
    const image = profile.image ? { url: profile.image } : imageOf(origin, null, settings['seo.defaultImage']);
    const graph = schemaGraph(await schemaSite(cms, origin, settings, input.locale), { kind: 'author', url, title: input.user.name, description, locale: input.locale, image, profile, breadcrumbs: [{ name: __('Home'), url: absolute(origin, '/') }] });
    return base(origin, settings, { title, ogTitle: input.user.name, description, url, image, robots: robotsDirectives(siteRobots(settings)), type: 'profile', locale: input.locale, links: input.links, graph });
}

/** The home page. */
export async function homeSeo(cms: CmsHost, c: Context, input: { url: string; locale: string; links: readonly LanguageLink[]; page?: number }): Promise<SeoView> {
    const settings = await cms.settings.all();
    const origin = siteOrigin(c);
    const page = input.page ?? 1;
    const url = absolute(origin, page > 1 ? `${input.url}?page=${page}` : input.url);
    const title = renderSeoTemplate(settings['seo.homeTitle'], { sep: separator(settings), site: settings['general.siteTitle'], tagline: settings['general.tagline'], page });
    const image = imageOf(origin, null, settings['seo.defaultImage']);
    const graph = schemaGraph(await schemaSite(cms, origin, settings, input.locale), { kind: 'home', url, title: settings['general.siteTitle'], description: settings['general.tagline'], locale: input.locale, image });
    return base(origin, settings, { title, ogTitle: settings['general.siteTitle'], description: settings['general.tagline'], url, image, robots: robotsDirectives(siteRobots(settings)), type: 'website', locale: input.locale, links: input.links, graph });
}
