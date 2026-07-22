/// <reference types="vite/client" />

// src/index.ts
import { createApp } from './router.js';
import { AppDurableObject } from './DurableObject.js';
// Side-effect: registers `__`, `setLocale`, `getLocale`, `isLocale` as globals.
import './i18n-globals.js';
// Side-effect: registers `config`, `env`, `binding` as globals.
import './config-globals.js';

// Create the Hono app. The vite plugin will handle injecting the pages.
const app = createApp();

// Export the Durable Object and the app fetch handler for the Cloudflare runtime
export { AppDurableObject };
// CacheDurableObject must be re-exported by apps using the durable-object cache
// driver (Cloudflare requires DO classes in the Worker entry's export graph).
export { CacheDurableObject } from './cache.js';
export default {
  fetch: app.fetch,
};
