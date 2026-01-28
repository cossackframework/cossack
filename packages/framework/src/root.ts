import { HeadTag } from '@cossackframework/core';
import { escapeHtml } from '@cossackframework/renderer';

type RenderRootProps = {
    body: string;
    initialState?: Record<string, any>;
    manifest: Record<string, any>;
    headTags?: HeadTag[];
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
    // In development, Vite handles assets. In production, we use the manifest.
    const clientScript = `/${props.manifest['src/client/entry-client.ts'].file}`;

    const css = `/${props.manifest['src/client/entry-client.ts'].css[0]}`;

    const initialStateScript = props.initialState
        ? `<script>window.__INITIAL_STATE__ = ${JSON.stringify(props.initialState)}</script>`
        : '';

    const headTagsHtml = (props.headTags || []).map(renderTag).join('\n');

    return `
        <!DOCTYPE html>
        <html lang="en">
            <head>
                ${headTagsHtml}
                <link rel="stylesheet" href="${css}">
                ${initialStateScript}
                <script type="module" src="${clientScript}"></script>
            </head>
            <body>
                <div id="root">${props.body}</div>
            </body>
        </html>
    `;
}
