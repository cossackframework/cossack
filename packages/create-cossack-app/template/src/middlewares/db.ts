import { createDbMiddleware, DatabaseCacheStore } from '@cossackframework/database';
import { extendCacheDriver } from '@cossackframework/framework/cache';
import { createClient } from '../db/config';

// Exposes the Kysely client on the request (`c.get('db')` / `getDb(c)`) and
// scopes the global `db()` helper to it. Registered in src/bootstrap/middlewares.ts.
export const dbMiddleware = createDbMiddleware({
  client: (c) => createClient(c.env),
});

// Register the database cache driver so `CACHE_DRIVER=database` works.
// Remove this (and the 'database' store in config/cache.ts) if you don't use
// database-backed caching, or swap it for your own driver (Redis, R2, …).
extendCacheDriver('database', () => new DatabaseCacheStore());
