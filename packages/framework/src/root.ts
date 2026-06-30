import { HeadTag } from '@cossackframework/core';
import { escapeHtml } from '@cossackframework/renderer';
import { minifyHtml } from '@cossackframework/renderer/server';

export interface TemplateHelpers {
    cossackScripts: () => string;
    cossackBody: () => string;
}

/**
 * Serialise state as JSON safe for embedding inside a `<script>` element.
 *
 * `JSON.stringify` alone does NOT escape `<`, `>`, `&`, U+2028 or U+2029, so
 * any user-controlled value (route params, comments, profile names, DB cells)
 * containing `</script><script>…` would close the tag and execute attacker
 * JS in every viewer's browser. We escape those characters to their JSON
 * unicode-escape forms (still valid JSON/JS) so the payload can no longer
 * break out of the script element.
 */
export const serializeInitialState = (state: unknown): string =>
    JSON.stringify(state)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');

type RenderRootProps = {
    body: string;
    initialState?: Record<string, any>;
    manifest: Record<string, any>;
    headTags?: HeadTag[];
    inlineCss?: string;
    modulePreloads?: string[];
    htmlTemplate?: string | ((helpers: TemplateHelpers) => string);
    /** Locale code for the `<html lang>` attribute. Defaults to `'en'`. */
    lang?: string;
    /** Optional modulepreload href for the predicted non-default locale chunk. */
    localePreloadHref?: string;
}

const renderTag = (tag: HeadTag) => {
    const attributes = { ...tag.attributes, 'data-cossack': '' };
    const attrs = Object.entries(attributes)
        .map(([key, value]) => {
            if (typeof value === 'boolean') {
                return value ? key : '';
            }
            return `${key}="${String(value)}"`;
        })
        .filter(Boolean)
        .join(' ');

    if (['meta', 'link', 'base'].includes(tag.tag)) {
        return `<${tag.tag} ${attrs}>`;
    }
    const children = tag.children ? escapeHtml(tag.children) : '';
    return `<${tag.tag} ${attrs}>${children}</${tag.tag}>`;
};

export const renderRoot = (props: RenderRootProps) => {
    // In development, Vite serves assets directly without a manifest.
    // In production, we use the manifest to resolve hashed filenames.
    // Note: We deliberately do NOT rely on import.meta.env.DEV/PROD here
    // because renderRoot is also invoked from the SSG build script (tsx),
    // where those Vite-defined globals are undefined. The manifest is the
    // authoritative signal: dev mode never has one, production always does.
    const hasManifest = !!(props.manifest && props.manifest['src/client/entry-client.ts']);
    const isDev = !hasManifest;
    const clientScript = isDev
        ? '/src/client/entry-client.ts'
        : hasManifest
            ? `/${props.manifest['src/client/entry-client.ts'].file}`
            : '/src/client/entry-client.ts';

    const css = isDev
        ? '/src/style.css'
        : hasManifest
            ? `/${props.manifest['src/client/entry-client.ts'].css[0]}`
            : '/src/style.css';

    const initialStateScript = props.initialState
        ? `<script>window.__INITIAL_STATE__ = ${serializeInitialState(props.initialState)}</script>`
        : '';

    const headTagsHtml = (props.headTags || []).map(renderTag).join('\n');

    // In dev mode, include a CSS link to /src/style.css which Vite's dev server
    // transforms and serves. In production, use the manifest-hashed filename
    // with optional inline CSS for faster initial paint.
    let cssHtml = '';
    if (isDev) {
        cssHtml = `<link rel="stylesheet" href="${escapeHtml(css)}">`;
    } else if (css) {
        cssHtml = props.inlineCss
            ? `<style>${props.inlineCss}</style><link rel="stylesheet" href="${escapeHtml(css)}" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" href="${escapeHtml(css)}"></noscript>`
            : `<link rel="stylesheet" href="${escapeHtml(css)}">`;
    }

    const modulePreloadHtml = (props.modulePreloads || [])
        .map(href => `<link rel="modulepreload" href="${escapeHtml(href)}">`)
        .join('\n');

    // Preload the predicted non-default locale chunk so a client-side
    // `setLocale()` switch is instant (the chunk is already cached).
    const localePreloadHtml = props.localePreloadHref
        ? `<link rel="modulepreload" href="${escapeHtml(props.localePreloadHref)}">`
        : '';

    const cossackScripts = () =>
        `${headTagsHtml}\n${cssHtml}\n${initialStateScript}\n${modulePreloadHtml}\n${localePreloadHtml}\n<script type="module" src="${escapeHtml(clientScript)}"></script>`;

    const cossackBody = () => `<div id="root">${props.body}</div>`;

    // `<html lang>` drives screen-reader pronunciation and search engines.
    // Defaults to 'en' for backward compatibility; the locale middleware
    // threads the resolved per-request locale through to here. Escaped as
    // defense-in-depth even though locale codes are normally alphanumeric.
    const langAttr = escapeHtml(props.lang || 'en');

    let raw: string;

    if (typeof props.htmlTemplate === 'function') {
        raw = props.htmlTemplate({ cossackScripts, cossackBody });
    } else if (typeof props.htmlTemplate === 'string') {
        raw = props.htmlTemplate
            .replace('{{ cossackScripts }}', cossackScripts())
            .replace('{{ cossackBody }}', cossackBody())
            .replace('{{ cossackLang }}', langAttr);
    } else {
        raw = `<!DOCTYPE html>
        <html lang="${langAttr}">
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                ${cossackScripts()}
            </head>
            <body class="antialiased">
                ${cossackBody()}
            </body>
        </html>
    `;
    }

    if (!isDev) {
        return minifyHtml(raw);
    }
    return raw;
}
