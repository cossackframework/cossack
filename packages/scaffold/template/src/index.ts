/// <reference types="vite/client" />

import { createApp } from '@cossackframework/framework/router';
import { AppDurableObject } from '@cossackframework/framework/DurableObject';
import { SseDurableObject } from '@cossackframework/framework/SseDurableObject';
import { App } from './App';
import { template } from './root';

const app = createApp({
  AppComponent: App,
  htmlTemplate: template,
  // Enable automatic browser-language detection via the Accept-Language header.
  // Off by default because it can affect caching/SEO. See docs/localization.md.
  // i18n: { autoDetectBrowser: true },
});

export { AppDurableObject };
// Cloudflare requires Durable Object classes in the Worker entry's export
// graph. SseDurableObject backs distributed SSE scope state (COSSACK_SSE).
export { SseDurableObject };
export default {
  fetch: app.fetch,
};
