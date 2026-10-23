/**
 * SEO data of site pages: titles with the site's separator, descriptions, canonical URLs,
 * social images, robots rules, language alternates and JSON-LD. Server-only; the page keeps
 * the result in state and `seoHead()` turns it into tags.
 */
import type { Context } from 'hono';
import { mediaUrl, TITLE_SEPARATORS, type CollectionDefinition, type EntryView, type LanguageLink, type RecordShape, type SiteSettings } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import type { SeoView } from './seo-head';

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

async function socialImage(cms: CmsHost, id: unknown, origin: string, settings: SiteSettings): Promise<string> {
    if (typeof id === 'string' && id && cms.files) {
        const file = await cms.files.get(id);
        if (file) return absolute(origin, mediaUrl(file));
    }
    return absolute(origin, settings['seo.defaultImage']);
}

/** An entry page: its SEO box first, then its title, excerpt and featured image. */
export async function entrySeo(cms: CmsHost, c: Context, collection: CollectionDefinition, record: RecordShape, view: EntryView, links: readonly LanguageLink[]): Promise<SeoView> {
    const settings = await cms.settings.all();
    const origin = siteOrigin(c);
    const seo = (record.seo ?? {}) as { title?: string; description?: string; image?: string | null; canonical?: string; noindex?: boolean };
    const canonical = absolute(origin, seo.canonical || view.url || '');
    const image = seo.image ? await socialImage(cms, seo.image, origin, settings) : view.image ? absolute(origin, view.image.url) : absolute(origin, settings['seo.defaultImage']);
    const description = seo.description || view.excerpt;
    const article = collection.name === 'posts';
    const published = typeof record.publishedAt === 'number' ? new Date(record.publishedAt).toISOString() : '';
    const modified = new Date(record.updatedAt).toISOString();
    const breadcrumbs = collection.hierarchical ? await ancestors(cms, collection, record) : [];
    const data = article ? {
        '@context': 'https://schema.org', '@type': 'BlogPosting', headline: view.title, description, url: canonical, mainEntityOfPage: canonical, inLanguage: view.locale,
        ...(published ? { datePublished: published } : {}), dateModified: modified, ...(image ? { image: [image] } : {}),
        ...(view.author ? { author: { '@type': 'Person', name: view.author } } : {}), publisher: { '@type': 'Organization', name: settings['general.siteTitle'] },
    } : {
        '@context': 'https://schema.org', '@type': 'WebPage', name: view.title, description, url: canonical, inLanguage: view.locale, dateModified: modified,
        ...(image ? { primaryImageOfPage: image } : {}),
        ...(breadcrumbs.length ? { breadcrumb: { '@type': 'BreadcrumbList', itemListElement: [...breadcrumbs, { name: view.title, url: view.url ?? '' }].map((crumb, index) => ({ '@type': 'ListItem', position: index + 1, name: crumb.name, item: absolute(origin, crumb.url) })) } } : {}),
    };
    return {
        title: `${seo.title || view.title} ${separator(settings)} ${settings['general.siteTitle']}`, description, canonical, image,
        robots: settings['reading.discourageSearchEngines'] ? 'noindex, nofollow' : seo.noindex ? 'noindex' : '',
        type: article ? 'article' : 'website', siteName: settings['general.siteTitle'], locale: view.locale, publishedTime: published, modifiedTime: modified,
        alternates: alternates(origin, links), jsonLd: JSON.stringify(data),
    };
}

/** Ancestors of a nested entry, top first, for breadcrumbs. */
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

/** A list page: an archive, a term archive or search results. */
export async function listSeo(cms: CmsHost, c: Context, input: { title: string; description: string; url: string; locale: string; links: readonly LanguageLink[]; noindex?: boolean }): Promise<SeoView> {
    const settings = await cms.settings.all();
    const origin = siteOrigin(c);
    return {
        title: input.title ? `${input.title} ${separator(settings)} ${settings['general.siteTitle']}` : settings['general.siteTitle'], description: input.description || settings['general.tagline'],
        canonical: absolute(origin, input.url), image: absolute(origin, settings['seo.defaultImage']),
        robots: settings['reading.discourageSearchEngines'] ? 'noindex, nofollow' : input.noindex ? 'noindex' : '',
        type: 'website', siteName: settings['general.siteTitle'], locale: input.locale, publishedTime: '', modifiedTime: '', alternates: alternates(origin, input.links),
        jsonLd: JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: input.title, url: absolute(origin, input.url), inLanguage: input.locale }),
    };
}

/** The home page, with the site's search box for search engines. */
export async function homeSeo(cms: CmsHost, c: Context, input: { url: string; locale: string; links: readonly LanguageLink[]; searchUrl: string }): Promise<SeoView> {
    const settings = await cms.settings.all();
    const origin = siteOrigin(c);
    const url = absolute(origin, input.url);
    return {
        title: `${settings['general.siteTitle']} ${separator(settings)} ${settings['general.tagline']}`, description: settings['general.tagline'], canonical: url,
        image: absolute(origin, settings['seo.defaultImage']), robots: settings['reading.discourageSearchEngines'] ? 'noindex, nofollow' : '',
        type: 'website', siteName: settings['general.siteTitle'], locale: input.locale, publishedTime: '', modifiedTime: '', alternates: alternates(origin, input.links),
        jsonLd: JSON.stringify({
            '@context': 'https://schema.org', '@type': 'WebSite', name: settings['general.siteTitle'], description: settings['general.tagline'], url, inLanguage: input.locale,
            potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${absolute(origin, input.searchUrl)}?q={search_term_string}` }, 'query-input': 'required name=search_term_string' },
        }),
    };
}
