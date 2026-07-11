// src/bootstrap/middlewares.ts
//
// Global request middleware registry (Laravel-style "kernel" list).
// `createApp()` auto-loads this file and registers each middleware with
// `app.use('*', ...)` in array order, before the locale middleware.
//
// Middleware *definitions* live in `src/middlewares/*.ts`; this file only
// holds the ordered references so you can add/remove features cleanly.

import type { MiddlewareHandler } from 'hono';
import { dbMiddleware } from '../middlewares/db';

const middlewares: MiddlewareHandler[] = [
  dbMiddleware,
];

export default middlewares;
