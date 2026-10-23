/**
 * Head tags of a site page from its SEO data: title, description, canonical link, robots,
 * Open Graph and Twitter cards, language alternates and JSON-LD. Client-safe; pages compute
 * the data on the server and keep it in state.
 */
import type { HeadValue } from '@cossackframework/core';

export interface SeoView {
    /** The whole `<title>`, site title included. */
    title: string;
    description: string;
    /** Absolute URL. */
    canonical: string;
    /** Absolute image URL, or empty. */
    image: string;
    /** `noindex` (with `nofollow` when the whole site is hidden), or empty. */
    robots: string;
    type: 'website' | 'article';
    siteName: string;
    /** BCP 47 language of the page, such as `en` or `pt-br`. */
    locale: string;
    publishedTime: string;
    modifiedTime: string;
    /** The page in other languages, absolute. */
    alternates: { hreflang: string; href: string }[];
    /** Structured data as JSON text, or empty. */
    jsonLd: string;
}

export function emptySeo(): SeoView {
    return { title: '', description: '', canonical: '', image: '', robots: '', type: 'website', siteName: '', locale: '', publishedTime: '', modifiedTime: '', alternates: [], jsonLd: '' };
}

export function seoHead(seo: SeoView): HeadValue {
    const meta = (property: string, content: string) => content ? [{ tag: 'meta', attributes: { property, content } }] : [];
    return {
        ...(seo.title ? { title: seo.title } : {}),
        ...(seo.description ? { description: seo.description } : {}),
        ...(seo.image ? { image: seo.image } : {}),
        meta: [
            ...(seo.robots ? [{ tag: 'meta', attributes: { name: 'robots', content: seo.robots } }] : []),
            ...meta('og:type', seo.type),
            ...meta('og:url', seo.canonical),
            ...meta('og:site_name', seo.siteName),
            ...meta('og:locale', seo.locale.replace('-', '_')),
            ...meta('article:published_time', seo.type === 'article' ? seo.publishedTime : ''),
            ...meta('article:modified_time', seo.type === 'article' ? seo.modifiedTime : ''),
            ...(seo.image ? [{ tag: 'meta', attributes: { name: 'twitter:card', content: 'summary_large_image' } }] : []),
        ],
        links: [
            ...(seo.canonical ? [{ tag: 'link', attributes: { rel: 'canonical', href: seo.canonical } }] : []),
            ...seo.alternates.map(alternate => ({ tag: 'link', attributes: { rel: 'alternate', hreflang: alternate.hreflang, href: alternate.href } })),
        ],
        scripts: seo.jsonLd ? [{ tag: 'script', attributes: { type: 'application/ld+json' }, children: seo.jsonLd }] : [],
    };
}
