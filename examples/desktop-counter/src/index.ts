import { serve } from '@hono/node-server';
import { serveStatic } from '@cossackframework/node-adapter';
import { createApp } from '@cossackframework/framework/router';
import { Hono } from 'hono';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { App } from './App';
import { template } from './root';

export const frameworkApp = createApp({ AppComponent: App, htmlTemplate: template });
export const app = new Hono();
app.use('*', serveStatic({
  root: fileURLToPath(new URL('../client', import.meta.url)),
  index: false,
}));
app.route('/', frameworkApp);

export const env: Record<string, unknown> = { ...process.env };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  serve({ fetch: (request) => app.fetch(request, env), port: Number(process.env.PORT) || 3000 });
}
