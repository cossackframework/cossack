// src/dialects/d1.ts
import {
    SqliteAdapter,
    SqliteIntrospector,
    SqliteQueryCompiler,
} from 'kysely';
import type {
    CompiledQuery,
    DatabaseConnection,
    DatabaseIntrospector,
    Dialect,
    Driver,
    Kysely,
    QueryResult,
} from 'kysely';
import type { D1DatabaseLike } from '../types';

/**
 * Kysely {@link Dialect} for Cloudflare D1.
 *
 * Uses Kysely's SQLite query compiler/adapter/introspector and a custom driver
 * that talks to the `D1Database` binding (`prepare().bind().all()`). No extra
 * runtime dependencies — the D1 binding is provided by the Workers runtime.
 *
 * Note: D1 does not support interactive (`BEGIN`/`COMMIT`) transactions; use
 * `db.batch([...])` for atomic multi-statement writes. Kysely's migrator is
 * unaffected because the SQLite adapter reports `supportsTransactionalDdl: false`.
 */
export class D1Dialect implements Dialect {
    constructor(private readonly d1: D1DatabaseLike) {}

    createDriver(): Driver {
        return new D1Driver(this.d1);
    }
    createQueryCompiler(): SqliteQueryCompiler {
        return new SqliteQueryCompiler();
    }
    createAdapter(): SqliteAdapter {
        return new SqliteAdapter();
    }
    createIntrospector(db: Kysely<any>): DatabaseIntrospector {
        return new SqliteIntrospector(db);
    }
}

/** Marshals a Kysely parameter into a value D1's `bind()` accepts. */
function marshalD1Param(value: unknown): unknown {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'bigint') return Number(value);
    if (value instanceof Date) return value.toISOString();
    return value;
}

class D1Driver implements Driver {
    private readonly connection: D1Connection;
    constructor(d1: D1DatabaseLike) {
        this.connection = new D1Connection(d1);
    }
    async init(): Promise<void> {}
    async acquireConnection(): Promise<DatabaseConnection> {
        return this.connection;
    }
    async beginTransaction(): Promise<void> {
        throw new Error(
            'D1 does not support interactive transactions. Use db.batch([...]) for atomic multi-statement writes instead.',
        );
    }
    async commitTransaction(): Promise<void> {
        throw new Error(
            'D1 does not support interactive transactions. Use db.batch([...]) for atomic multi-statement writes instead.',
        );
    }
    async rollbackTransaction(): Promise<void> {
        throw new Error(
            'D1 does not support interactive transactions. Use db.batch([...]) for atomic multi-statement writes instead.',
        );
    }
    async releaseConnection(): Promise<void> {}
    async destroy(): Promise<void> {}
}

class D1Connection implements DatabaseConnection {
    constructor(private readonly d1: D1DatabaseLike) {}

    async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
        const statement = this.d1.prepare(compiledQuery.sql);
        const bound =
            compiledQuery.parameters.length > 0
                ? statement.bind(...compiledQuery.parameters.map(marshalD1Param))
                : statement;
        const result = await bound.all<R>();

        const rows = (result.results ?? []) as R[];
        const out: { rows: R[]; numAffectedRows?: bigint; insertId?: bigint } = { rows };
        const changes = result.meta?.changes;
        const lastRowId = result.meta?.last_row_id;
        if (typeof changes === 'number') out.numAffectedRows = BigInt(changes);
        if (lastRowId !== undefined && lastRowId !== null) out.insertId = BigInt(lastRowId);
        return out as QueryResult<R>;
    }

    async *streamQuery<R>(compiledQuery: CompiledQuery): AsyncIterableIterator<QueryResult<R>> {
        yield await this.executeQuery<R>(compiledQuery);
    }
}
