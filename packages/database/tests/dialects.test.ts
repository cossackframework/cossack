// tests/dialects.test.ts
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createClient } from '@libsql/client';
import type { Kysely } from 'kysely';
import { createDatabase, type D1Config, type D1DatabaseLike, type D1ResultLike, type LibsqlConfig } from '../src';

/** Loose DB type — these tests exercise runtime dialect plumbing, not schema typing. */
type AnyDb = Kysely<any>;
const makeDb = (config: D1Config | LibsqlConfig) => createDatabase(config) as AnyDb;

describe('LibsqlDialect (via @libsql/client local file)', () => {
    it('round-trips create/insert/select and reports affected rows + insert id', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-libsql-'));
        const dbPath = path.join(dir, 'test.sqlite');
        try {
            const client = createClient({ url: `file:${dbPath}` });
            const db = makeDb({ dialect: 'libsql', client });

            await db.schema
                .createTable('users')
                .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
                .addColumn('email', 'text', (c) => c.notNull())
                .execute();

            const inserted = await db
                .insertInto('users')
                .values({ email: 'alice@cossack.dev' })
                .executeTakeFirstOrThrow();
            // libSQL returns lastInsertRowid on inserts
            expect(Number(inserted.insertId)).toBeGreaterThan(0);

            const rows = await db.selectFrom('users').selectAll().execute();
            expect(rows).toHaveLength(1);
            expect((rows[0] as any).email).toBe('alice@cossack.dev');

            await db.destroy();
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it('marshals boolean parameters', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-libsql-'));
        const dbPath = path.join(dir, 'test.sqlite');
        try {
            const client = createClient({ url: `file:${dbPath}` });
            const db = makeDb({ dialect: 'libsql', client });

            await db.schema
                .createTable('flags')
                .addColumn('id', 'integer', (c) => c.primaryKey())
                .addColumn('active', 'integer')
                .execute();
            await db.insertInto('flags').values({ id: 1, active: true } as any).execute();
            const row = await db.selectFrom('flags').selectAll().where('id', '=', 1).executeTakeFirst();
            // libSQL stores booleans as 1/0
            expect(Number((row as any)?.active)).toBe(1);
            await db.destroy();
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});

/** Minimal in-memory D1 mock that records the last prepared statement. */
function createD1Mock() {
    let lastSql = '';
    let lastParams: unknown[] = [];
    const mock: D1DatabaseLike = {
        prepare(sql: string) {
            lastSql = sql;
            lastParams = [];
            const stmt = {
                bind(...vals: unknown[]) {
                    lastParams = vals;
                    return stmt;
                },
                // The D1 connection routes every query through `.all()`, which
                // returns both `results` (rows) and `meta` (changes/last_row_id).
                async all<T = unknown>(): Promise<D1ResultLike<T>> {
                    return {
                        results: [{ id: 1, email: 'mock@cossack.dev' }] as unknown as T[],
                        success: true,
                        meta: { changes: 3, last_row_id: 42 },
                    };
                },
                async run<T = unknown>(): Promise<D1ResultLike<T>> {
                    return { results: [], success: true, meta: { changes: 3, last_row_id: 42 } };
                },
                async first<T = unknown>(): Promise<T | null> {
                    return null;
                },
            };
            return stmt;
        },
    };
    return { mock, getLast: () => ({ sql: lastSql, params: lastParams }) };
}

describe('D1Dialect (via mock binding)', () => {
    it('executes queries through the binding and maps meta -> insertId/affected', async () => {
        const { mock } = createD1Mock();
        const db = makeDb({ dialect: 'd1', binding: mock });

        const rows = await db.selectFrom('users').selectAll().execute();
        expect(rows[0]).toMatchObject({ email: 'mock@cossack.dev' });

        const res = await db.insertInto('users').values({ email: 'x@cossack.dev' } as any).executeTakeFirst();
        // The mock's `.all()` reports changes=3, last_row_id=42. Kysely maps
        // QueryResult.numAffectedRows -> InsertResult.numInsertedOrUpdatedRows.
        expect(Number(res?.numInsertedOrUpdatedRows)).toBe(3);
        expect(Number(res?.insertId)).toBe(42);

        await db.destroy();
    });

    it('marshals boolean parameters for D1 bind()', async () => {
        const { mock, getLast } = createD1Mock();
        const db = makeDb({ dialect: 'd1', binding: mock });
        await db.selectFrom('users').selectAll().where('active', '=', true as any).execute();
        // D1 bind() doesn't accept booleans — the dialect converts true -> 1.
        expect(getLast().params).toContain(1);
    });
});
