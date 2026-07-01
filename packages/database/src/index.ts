// src/index.ts

// Re-export all of Kysely so consumers don't need to install it separately.
// `Kysely`, `Generated`, `sql`, `Insertable`, `Selectable`, etc. are all
// available via `import { ... } from '@cossackframework/database'`.
export * from 'kysely';
export { Migrator, FileMigrationProvider, NO_MIGRATIONS } from 'kysely/migration';
export type {
    Migration,
    MigrationProvider,
    MigrationResultSet,
    MigrationResult,
    MigrationInfo,
} from 'kysely/migration';

// Core API
export { createDatabase } from './create-database';
export { createDbMiddleware } from './middleware';
export type { DbMiddlewareOptions } from './middleware';
export { getDb } from './accessor';
export { db, setDbStoreGetter } from './store';
export { ensureDbAlsWired, runWithDb } from './als';

// Dialects (advanced — for custom Kysely instances)
export { D1Dialect } from './dialects/d1';
export { LibsqlDialect } from './dialects/libsql';

// Migrations & seeders
export {
    runMigrations,
    resetMigrations,
    getMigrationStatus,
    formatMigrationResult,
    defaultMigrationsFolder,
} from './migrations/migrator';
export type { RunMigrationsOptions, MigrationDirection } from './migrations/migrator';
export { runSeeders, defaultSeedersFolder } from './seeder/runner';
export type { Seeder, RunSeedersOptions } from './seeder/runner';

// Types
export type {
    Database,
    DbClient,
    DbConfig,
    D1Config,
    LibsqlConfig,
    D1DatabaseLike,
    D1PreparedStatementLike,
    D1ResultLike,
    LibsqlClientLike,
    LibsqlInStatement,
    LibsqlResultSetLike,
    LibsqlRowLike,
} from './types';
