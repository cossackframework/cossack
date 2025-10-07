/// <reference types="vite/client" />

// src/index.ts
import { createApp } from './router';
import { AppDurableObject } from './DurableObject';

// Create the Hono app. The vite plugin will handle injecting the pages.
const app = createApp();

// Export the Durable Object and the app fetch handler for the Cloudflare runtime
export { AppDurableObject };
export default {
  fetch: app.fetch,
};