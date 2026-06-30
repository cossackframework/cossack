// tests/migrations.test.ts
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createClient } from '@libsql/client';
import type { Kysely } from 'kysely';
import { createDatabase, runMigrations, getMigrationStatus } from '../src';

type AnyDb = Kysely<any>;
const makeDb = (dbPath: string): AnyDb =>
    createDatabase({ dialect: 'libsql', client: createClient({ url: `file:${dbPath}` }) }) as AnyDb;

async function withTempMigrations(fn: (folder: string, dbPath: string) => Promise<void>) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-mig-'));
    const migDir = path.join(dir, 'src', 'migrations');
    await fs.mkdir(migDir, { recursive: true });
    await fs.writeFile(
        path.join(migDir, '0001_create_users.ts'),
        [
            `import type { Kysely } from '@cossackframework/database';`,
            `export async function up(db: Kysely<any>) {`,
            `  await db.schema.createTable('users')`,
            `    .addColumn('id', 'integer', (c) => c.primaryKey())`,
            `    .addColumn('email', 'text').execute();`,
            `}`,
            `export async function down(db: Kysely<any>) {`,
            `  await db.schema.dropTable('users').execute();`,
            `}`,
        ].join('\n'),
    );
    const dbPath = path.join(dir, 'app.sqlite');
    try {
        await fn(migDir, dbPath);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

describe('migrator', () => {
    it('applies migrations and records them in the migration table', async () => {
        await withTempMigrations(async (folder, dbPath) => {
            const client = makeDb(dbPath);
            const result = await runMigrations('latest', { client, folder });
            expect(result.error).toBeUndefined();
            expect(result.results?.[0]?.status).toBe('Success');
            await client.destroy();

            // A fresh client on the same DB should report the migration as run.
            const client2 = makeDb(dbPath);
            const status = await getMigrationStatus({ client: client2, folder });
            expect(status[0].name).toContain('create_users');
            expect(status[0].executedAt).toBeInstanceOf(Date);

            // The `users` table exists.
            const rows = await client2.selectFrom('users').selectAll().execute();
            expect(rows).toEqual([]);
            await client2.destroy();
        });
    });

    it('reverts the latest migration with direction=down', async () => {
        await withTempMigrations(async (folder, dbPath) => {
            const up = makeDb(dbPath);
            await runMigrations('latest', { client: up, folder });
            await up.destroy();

            const down = makeDb(dbPath);
            const result = await runMigrations('down', { client: down, folder });
            expect(result.error).toBeUndefined();
            expect(result.results?.[0]?.direction).toBe('Down');
            await down.destroy();
        });
    });

    it('formatMigrationResult handles empty / error states', async () => {
        const { formatMigrationResult } = await import('../src');
        expect(formatMigrationResult({ results: [] })).toMatch(/No migrations to run/);
        expect(formatMigrationResult({ error: new Error('boom') })).toMatch(/Migration failed: boom/);
    });
});
