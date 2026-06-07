/// <reference types="vite/client" />

import 'reflect-metadata';
import { createApp } from '@cossackframework/framework/router';
import { AppDurableObject } from '@cossackframework/framework/DurableObject';
import { App } from './App';
import { template } from './root';

const app = createApp({ AppComponent: App, htmlTemplate: template });

export { AppDurableObject };
export default {
  fetch: app.fetch,
};
