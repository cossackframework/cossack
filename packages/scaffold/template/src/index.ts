/// <reference types="vite/client" />

import 'reflect-metadata';
import { createApp } from '@cossackframework/framework/router';
import { AppDurableObject } from '@cossackframework/framework/DurableObject';
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
export default {
  fetch: app.fetch,
};
