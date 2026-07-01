// src/config/middlewares.ts
//
// Global request middleware registry (Laravel-style "kernel" list).
// `createApp()` auto-loads this file and registers each middleware with
// `app.use('*', ...)` in array order, before the locale middleware.
//
// Middleware *definitions* live in `src/middlewares/*.ts`; this file only
// holds the ordered references so you can add/remove features cleanly.
// Example (after running `cossack add database`):
//
//   import type { MiddlewareHandler } from 'hono';
//   import { dbMiddleware } from '../middlewares/db';
//
//   const middlewares: MiddlewareHandler[] = [
//     dbMiddleware,
//   ];
//   export default middlewares;

import type { MiddlewareHandler } from 'hono';

const middlewares: MiddlewareHandler[] = [];

export default middlewares;
