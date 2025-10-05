/// <reference types="vite/client" />

// src/index.ts
import { createApp, type PageModule } from './router';
import { AppDurableObject } from './DurableObject';

// Import pages from the framework package and assert the correct type
const pages = import.meta.glob('./pages/**/index.ts', { eager: true }) as Record<string, PageModule>;

// Create the Hono app with the discovered pages
const app = createApp(pages);

// Export the Durable Object and the app fetch handler for the Cloudflare runtime
export { AppDurableObject };
export default {
  fetch: app.fetch,
};