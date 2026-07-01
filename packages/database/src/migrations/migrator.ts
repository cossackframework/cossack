// src/migrations/migrator.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { FileMigrationProvider, Migrator, NO_MIGRATIONS } from 'kysely/migration';
import type { MigrationResultSet } from 'kysely/migration';
import type { DbClient } from '../types';

export interface RunMigrationsOptions {
    client: DbClient;
    /** Absolute path to the folder holding migration files (default `src/migrations`). */
    folder?: string;
    /** Name of the migrations bookkeeping table (Kysely default `kysely_migration`). */
    migrationTableName?: string;
}

export type MigrationDirection = 'up' | 'down' | 'latest';

/**
 * Runs Kysely migrations discovered as `.ts`/`.js` files in `folder`.
 *
 * - `up` / `latest` — apply all pending migrations (`migrateToLatest`).
 * - `down`          — revert the single most recent migration (`migrateDown`).
 *
 * Use {@link resetMigrations} to roll everything back.
 */
export async function runMigrations(
    direction: MigrationDirection,
    options: RunMigrationsOptions,
): Promise<MigrationResultSet> {
    const folder = options.folder ?? defaultMigrationsFolder();
    const migrator = new Migrator({
        db: options.client as any,
        provider: new FileMigrationProvider({ fs, path, migrationFolder: folder }),
        migrationTableName: options.migrationTableName,
    });

    const result =
        direction === 'down' ? await migrator.migrateDown() : await migrator.migrateToLatest();
    return result;
}

/**
 * Rolls back every migration (runs all `down` handlers down to nothing).
 */
export async function resetMigrations(options: RunMigrationsOptions): Promise<MigrationResultSet> {
    const folder = options.folder ?? defaultMigrationsFolder();
    const migrator = new Migrator({
        db: options.client as any,
        provider: new FileMigrationProvider({ fs, path, migrationFolder: folder }),
        migrationTableName: options.migrationTableName,
    });
    return migrator.migrateTo(NO_MIGRATIONS);
}

/** Returns each migration with its execution state (executedAt if run). */
export async function getMigrationStatus(
    options: RunMigrationsOptions,
): Promise<Array<{ name: string; executedAt?: Date }>> {
    const folder = options.folder ?? defaultMigrationsFolder();
    const migrator = new Migrator({
        db: options.client as any,
        provider: new FileMigrationProvider({ fs, path, migrationFolder: folder }),
        migrationTableName: options.migrationTableName,
    });
    const infos = await migrator.getMigrations();
    return infos.map((it) => ({ name: it.name, executedAt: it.executedAt }));
}

/** Prints a human-readable summary of a migration result set. */
export function formatMigrationResult(result: MigrationResultSet): string {
    if (result.error) {
        const msg = result.error instanceof Error ? result.error.message : String(result.error);
        return `Migration failed: ${msg}`;
    }
    const items = result.results ?? [];
    if (items.length === 0) {
        return 'No migrations to run.';
    }
    return items
        .map((it) => {
            const tag = it.status === 'Success' ? '✓' : it.status === 'Error' ? '✗' : '·';
            return `${tag} ${it.direction.toLowerCase()}  ${it.migrationName}`;
        })
        .join('\n');
}

/** Default migration folder, resolved relative to the current working directory. */
export function defaultMigrationsFolder(): string {
    return path.resolve(process.cwd(), 'src', 'migrations');
}
