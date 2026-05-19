import { HeadTag } from '@cossackframework/core';
import { escapeHtml } from '@cossackframework/renderer';
import { minifyHtml } from '@cossackframework/renderer/server';

type RenderRootProps = {
    body: string;
    initialState?: Record<string, any>;
    manifest: Record<string, any>;
    headTags?: HeadTag[];
    inlineCss?: string;
    modulePreloads?: string[];
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
    const isDev = import.meta.env.DEV;
    const hasManifest = props.manifest && props.manifest['src/client/entry-client.ts'];
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
        ? `<script>window.__INITIAL_STATE__ = ${JSON.stringify(props.initialState)}</script>`
        : '';

    const headTagsHtml = (props.headTags || []).map(renderTag).join('\n');

    // In dev mode, include a CSS link to /src/style.css which Vite's dev server
    // transforms and serves. In production, use the manifest-hashed filename
    // with optional inline CSS for faster initial paint.
    let cssHtml = '';
    if (isDev) {
        cssHtml = `<link rel="stylesheet" href="${css}">`;
    } else if (css) {
        cssHtml = props.inlineCss
            ? `<style>${props.inlineCss}</style><link rel="stylesheet" href="${css}" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" href="${css}"></noscript>`
            : `<link rel="stylesheet" href="${css}">`;
    }

    const raw = `
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="utf-8">
                ${headTagsHtml}
                ${cssHtml}
                ${initialStateScript}
                ${(props.modulePreloads || []).map(href => `<link rel="modulepreload" href="${href}">`).join('\n                ')}
                <script type="module" src="${clientScript}"></script>
            </head>
            <body>
                <div id="root">${props.body}</div>
            </body>
        </html>
    `;

    if (import.meta.env.PROD) {
        return minifyHtml(raw);
    }
    return raw;
}
