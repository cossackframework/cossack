// src/config/middlewares.ts
//
// Global request middleware registry (Laravel-style "kernel" list).
// `createApp()` auto-loads this file and registers each middleware with
// `app.use('*', ...)` in array order, before the locale middleware.
//
// Middleware *definitions* live in `src/middlewares/*.ts`; this file only
// holds the ordered references, so adding/removing a feature is a one-line
// edit (no `createApp()` surgery). The locale middleware is framework-built-in
// and always runs — it doesn't need an entry here.

import type { MiddlewareHandler } from 'hono';

// Example middleware definitions available in this project:
// import { loggingMiddleware } from '../middlewares/logging';
// Database (after `cossack add database`):
// import { dbMiddleware } from '../middlewares/db';

const middlewares: MiddlewareHandler[] = [
  // loggingMiddleware,        // logs every request — see src/middlewares/logging.ts
  // dbMiddleware,             // exposes c.get('db') + the db() helper — requires @cossackframework/database
];

export default middlewares;
