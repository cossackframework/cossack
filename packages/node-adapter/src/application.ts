import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setClientAddress } from '@cossackframework/core';
import { STATIC_ASSET_DIRECTORY } from '@cossackframework/core/static-assets';
import { createStaticAssets, serveStatic } from './static-serve';
import { createNodeEmailSender } from './email';
import { installNodeShutdown } from './shutdown';
import type { createNodeAdapter } from './adapter';

type Variables = Record<string, string | undefined>;
type Bindings = Record<string, unknown>;

export interface NodeApplicationOptions {
    /** The runtime adapter the framework application was created with. */
    runtime: ReturnType<typeof createNodeAdapter>;
    /** The framework application's `fetch`. */
    fetch(request: Request, env: never): Response | Promise<Response>;
    /** `import.meta.url` of the entry module: the built entry is `dist/server/index.js`, beside `dist/client`. */
    entry: string;
    /** `import.meta.env?.DEV` of the entry module. The Vite plugin makes the bindings in development. */
    dev?: boolean;
    /** More bindings, made from the environment variables. They replace the defaults of the same name. */
    bindings?(variables: Variables): Bindings | Promise<Bindings>;
    /** Runs once the production server listens, with the bindings. */
    started?(env: Bindings): void;
}

export interface NodeApplication {
    /** The Hono application: hashed build output first, then the framework. */
    app: Hono;
    /** The binding factory, which production and the Node Vite plugin share. */
    createEnv(variables?: Variables): Promise<Bindings>;
    /** The production bindings; empty in development. */
    env: Bindings;
}

/**
 * The Node server of a Cossack application. A project's `src/index.ts` exports its result:
 *
 *   export const runtime = createNodeAdapter();
 *   const frameworkApp = createApp({ AppComponent: App, htmlTemplate: template, runtimeAdapter: runtime });
 *   export const { app, createEnv, env } = await nodeApplication({
 *     runtime, fetch: frameworkApp.fetch, entry: import.meta.url, dev: import.meta.env?.DEV,
 *   });
 *
 * It starts the server when the entry module is the program Node runs (`node dist/server/index.js`).
 */
export async function nodeApplication(options: NodeApplicationOptions): Promise<NodeApplication> {
    const app = new Hono();
    // Hashed build output skips the request pipeline, as Cloudflare serves the directory
    // without the Worker. Missing files continue to the framework.
    app.use(`/${STATIC_ASSET_DIRECTORY}/*`, serveStatic({
        root: fileURLToPath(new URL(`../client/${STATIC_ASSET_DIRECTORY}`, options.entry)),
        prefix: `/${STATIC_ASSET_DIRECTORY}`,
        index: false,
        cacheControl: (_filePath, urlPath) => /\.[a-zA-Z0-9_-]{8,}\.[^/]+$/.test(urlPath)
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=0, must-revalidate',
    }));
    // Everything else, including public/ files, runs global and page policies first; the
    // framework serves those files from ASSETS. Delegation preserves the framework's custom
    // 404 handler and request scope.
    app.all('*', c => options.fetch(c.req.raw, c.env as never));

    const createEnv = async (variables: Variables = process.env): Promise<Bindings> => {
        const bindings: Bindings = {
            ...variables,
            ASSETS: createStaticAssets({ root: fileURLToPath(new URL('../client', options.entry)), index: false, cacheControl: 'public, max-age=0, must-revalidate' }),
        };
        if (variables.SMTP_HOST) {
            const { SMTP_USER: user, SMTP_PASS: pass } = variables;
            if (!user || !pass) throw new Error('SMTP_HOST requires SMTP_USER and SMTP_PASS');
            bindings.EMAIL = createNodeEmailSender({
                host: variables.SMTP_HOST,
                port: Number(variables.SMTP_PORT ?? 587),
                secure: variables.SMTP_SECURE === 'true',
                auth: { user, pass },
                from: variables.MAIL_FROM ?? 'no-reply@example.com',
            });
        }
        return { ...bindings, ...await options.bindings?.(variables) };
    };
    const env: Bindings = options.dev ? {} : await createEnv();

    if (process.argv[1] && options.entry === pathToFileURL(process.argv[1]).href) {
        // Record the socket peer so rate limits never trust client-supplied IP headers.
        const fetch = (request: Request, node?: { incoming?: { socket?: { remoteAddress?: string } } }) => {
            setClientAddress(request, node?.incoming?.socket?.remoteAddress);
            return app.fetch(request, env);
        };
        const server = serve({ fetch, port: Number(process.env.PORT) || 3000 });
        options.runtime.attach(server, fetch);
        options.started?.(env);
        installNodeShutdown(server, {
            dispose: () => options.runtime.dispose(),
            onComplete: result => process.exit(result.forced || result.cleanupFailed ? 1 : 0),
        });
    }
    return { app, createEnv, env };
}
