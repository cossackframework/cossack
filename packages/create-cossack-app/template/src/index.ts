/// <reference types="vite/client" />

import 'reflect-metadata';
import { createApp } from './router';
import { AppDurableObject } from './DurableObject';

const app = createApp();

export { AppDurableObject };
export default {
  fetch: app.fetch,
};
