/// <reference types="vite/client" />

import 'reflect-metadata';
import { createApp } from '@cossackframework/framework/router';
import { AppDurableObject } from '@cossackframework/framework/DurableObject';

const app = createApp();

export { AppDurableObject };
export default {
  fetch: app.fetch,
};
