type RenderRootProps = {
    body: string;
    initialState?: Record<string, any>;
    manifest: Record<string, any>;
}

export const renderRoot = (props: RenderRootProps) => {
    // In development, Vite handles assets. In production, we use the manifest.
    const clientScript = `/${props.manifest['src/client/entry-client.ts'].file}`;

    const css = `/${props.manifest['src/client/entry-client.ts'].css[0]}`;

    const initialStateScript = props.initialState
        ? `<script>window.__INITIAL_STATE__ = ${JSON.stringify(props.initialState)}</script>`
        : '';

    return `
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <title>Cossack Demo</title>
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