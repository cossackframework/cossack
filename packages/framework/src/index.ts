/// <reference types="vite/client" />

// src/index.ts
import { createApp } from './router';
import { AppDurableObject } from './DurableObject';
// Side-effect: registers `__`, `setLocale`, `getLocale`, `isLocale` as globals.
import './i18n-globals';
// Side-effect: registers `config`, `env`, `binding` as globals.
import './config-globals';

// Create the Hono app. The vite plugin will handle injecting the pages.
const app = createApp();

// Export the Durable Object and the app fetch handler for the Cloudflare runtime
export { AppDurableObject };
// CacheDurableObject must be re-exported by apps using the durable-object cache
// driver (Cloudflare requires DO classes in the Worker entry's export graph).
export { CacheDurableObject } from './cache';
export default {
  fetch: app.fetch,
};
