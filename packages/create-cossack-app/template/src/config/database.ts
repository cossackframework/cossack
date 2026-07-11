// src/config/database.ts
//
// Database configuration. Included by default in new Cossack apps — the
// framework depends on @cossackframework/database, and a dbMiddleware is
// registered in src/bootstrap/middlewares.ts.
//
// The default connection is 'd1' (Cloudflare D1). Set DB_CONNECTION=turso
// and swap src/db/config.ts for the Turso variant to use Turso/libSQL.
// Kysely is the query builder, so other dialects (Postgres, MySQL) can be
// wired in src/db/config.ts if desired.
import type { EnvFunction } from '@cossackframework/framework/config';

export interface DatabaseConfig {
    /** The default connection name ('d1' or 'turso'). */
    default: string;
}

declare module '@cossackframework/framework/config' {
    interface CossackConfigRegistry {
        database: DatabaseConfig;
    }
}

export default ({ env }: { env: EnvFunction }): DatabaseConfig => ({
    // Driven by the DB_CONNECTION env var, defaulting to D1 (Cloudflare).
    // For Turso/libSQL, set DB_CONNECTION=turso in .dev.vars / wrangler vars.
    default: env('DB_CONNECTION', 'd1'),
});
