/// <reference types="vite/client" />

import { createApp } from '@cossackframework/framework';
import { AppDurableObject } from './DurableObject';

const app = createApp();

export { AppDurableObject };
export default {
  fetch: app.fetch,
};