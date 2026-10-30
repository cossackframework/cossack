/**
 * Head tags of a site page from its SEO data: title, description, canonical link, robots,
 * Open Graph and Twitter cards, language alternates and JSON-LD. Client-safe; pages compute
 * the data on the server and keep it in state.
 */
import type { HeadValue } from '@cossackframework/core';

export interface SeoView {
    /** The whole `<title>`, from the template. */
    title: string;
    /** The title shared links carry: the page's own, without the site title. */
    ogTitle: string;
    /** The description shared links carry; the meta description unless a social one is set. */
    ogDescription: string;
    description: string;
    /** Absolute URL. */
    canonical: string;
    /** Absolute image URL, or empty. */
    image: string;
    imageWidth: number | null;
    imageHeight: number | null;
    imageAlt: string;
    /** Robots directives such as `noindex, max-image-preview:large`, or empty. */
    robots: string;
    type: 'website' | 'article' | 'profile';
    siteName: string;
    /** BCP 47 language of the page, such as `en` or `pt-br`. */
    locale: string;
    /** The site's X account, with `@`, or empty. */
    twitterSite: string;
    publishedTime: string;
    modifiedTime: string;
    /** The page in other languages, absolute. */
    alternates: { hreflang: string; href: string }[];
    /** Structured data as JSON text, or empty. */
    jsonLd: string;
    /** The entry as Markdown (`?format=md`), absolute, or empty. */
    markdownUrl: string;
}

export function emptySeo(): SeoView {
    return { title: '', ogTitle: '', ogDescription: '', description: '', canonical: '', image: '', imageWidth: null, imageHeight: null, imageAlt: '', robots: '', type: 'website', siteName: '', locale: '', twitterSite: '', publishedTime: '', modifiedTime: '', alternates: [], jsonLd: '', markdownUrl: '' };
}

export function seoHead(seo: SeoView): HeadValue {
    const meta = (property: string, content: string) => content ? [{ tag: 'meta', attributes: { property, content } }] : [];
    const name = (key: string, content: string) => content ? [{ tag: 'meta', attributes: { name: key, content } }] : [];
    return {
        ...(seo.title ? { title: seo.title } : {}),
        ...(seo.image ? { image: seo.image } : {}),
        meta: [
            // The meta description and the shared one apart, so a social description can differ.
            ...name('description', seo.description),
            ...meta('og:description', seo.ogDescription || seo.description),
            ...name('robots', seo.robots),
            ...meta('og:type', seo.type),
            ...meta('og:title', seo.ogTitle),
            ...meta('og:url', seo.canonical),
            ...meta('og:site_name', seo.siteName),
            ...meta('og:locale', seo.locale.replace('-', '_')),
            ...meta('og:image:width', seo.image && seo.imageWidth ? String(seo.imageWidth) : ''),
            ...meta('og:image:height', seo.image && seo.imageHeight ? String(seo.imageHeight) : ''),
            ...meta('og:image:alt', seo.image ? seo.imageAlt : ''),
            ...meta('article:published_time', seo.type === 'article' ? seo.publishedTime : ''),
            ...meta('article:modified_time', seo.type === 'article' ? seo.modifiedTime : ''),
            ...name('twitter:card', seo.image ? 'summary_large_image' : 'summary'),
            ...name('twitter:site', seo.twitterSite),
            ...name('twitter:title', seo.ogTitle),
            ...name('twitter:description', seo.ogDescription || seo.description),
        ],
        links: [
            ...(seo.canonical ? [{ tag: 'link', attributes: { rel: 'canonical', href: seo.canonical } }] : []),
            ...seo.alternates.map(alternate => ({ tag: 'link', attributes: { rel: 'alternate', hreflang: alternate.hreflang, href: alternate.href } })),
            ...(seo.markdownUrl ? [{ tag: 'link', attributes: { rel: 'alternate', type: 'text/markdown', href: seo.markdownUrl } }] : []),
        ],
        scripts: seo.jsonLd ? [{ tag: 'script', attributes: { type: 'application/ld+json' }, children: seo.jsonLd }] : [],
    };
}
