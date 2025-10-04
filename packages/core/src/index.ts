// src/index.ts
import app from './router';
import { CossackDurableObject } from './shared/CossackDurableObject';

export { CossackDurableObject };

export default {
  fetch: app.fetch,
};
