import { serve } from '@hono/node-server';
import { createStaticAssets, serveStatic } from '@cossackframework/node-adapter';
import { createApp } from '@cossackframework/framework/router';
import { Hono } from 'hono';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { App } from './App';
import { template } from './root';

export const frameworkApp = createApp({ AppComponent: App, htmlTemplate: template });
export const app = new Hono();
const clientRoot = fileURLToPath(new URL('../client', import.meta.url));
app.use('*', serveStatic({ root: clientRoot, index: false }));
app.route('/', frameworkApp);

// The framework reads the client manifest through ASSETS.
export const env: Record<string, unknown> = { ...process.env, ASSETS: createStaticAssets({ root: clientRoot }) };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  serve({ fetch: (request) => app.fetch(request, env), port: Number(process.env.PORT) || 3000 });
}
