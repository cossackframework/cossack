// src/dialects/libsql.ts
import {
    CompiledQuery,
    SqliteAdapter,
    SqliteIntrospector,
    SqliteQueryCompiler,
} from 'kysely';
import type {
    DatabaseConnection,
    DatabaseIntrospector,
    Dialect,
    Driver,
    Kysely,
    QueryResult,
} from 'kysely';
import type { LibsqlClientLike, LibsqlResultSetLike } from '../types';

/**
 * Kysely {@link Dialect} for libSQL / Turso.
 *
 * Works with any client that matches the libSQL `Client` contract — pass one
 * built from `@tursodatabase/serverless/compat` (recommended, fetch-based, runs
 * on Workers + Node) or `@libsql/client/web`.
 *
 * The libSQL client returns rows as array-indexable objects; we remap them to
 * plain objects keyed by column name for Kysely.
 */
export class LibsqlDialect implements Dialect {
    constructor(private readonly client: LibsqlClientLike) {}

    createDriver(): Driver {
        return new LibsqlDriver(this.client);
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

function toRows<R>(resultSet: LibsqlResultSetLike): R[] {
    const { columns, rows } = resultSet;
    return rows.map((row) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < columns.length; i++) {
            obj[columns[i]] = row[i];
        }
        return obj as R;
    });
}

class LibsqlDriver implements Driver {
    private readonly connection: LibsqlConnection;
    constructor(client: LibsqlClientLike) {
        this.connection = new LibsqlConnection(client);
    }
    async init(): Promise<void> {}
    async acquireConnection(): Promise<DatabaseConnection> {
        return this.connection;
    }
    async beginTransaction(connection: DatabaseConnection): Promise<void> {
        await connection.executeQuery(CompiledQuery.raw('BEGIN'));
    }
    async commitTransaction(connection: DatabaseConnection): Promise<void> {
        await connection.executeQuery(CompiledQuery.raw('COMMIT'));
    }
    async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
        await connection.executeQuery(CompiledQuery.raw('ROLLBACK'));
    }
    async releaseConnection(): Promise<void> {}
    async destroy(): Promise<void> {
        this.connection.close();
    }
}

class LibsqlConnection implements DatabaseConnection {
    constructor(private readonly client: LibsqlClientLike) {}

    close(): void {
        this.client.close?.();
    }

    async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
        const args = compiledQuery.parameters.map((p) => (p === undefined ? null : p));
        const resultSet = await this.client.execute({ sql: compiledQuery.sql, args });

        const out: { rows: R[]; numAffectedRows?: bigint; insertId?: bigint } = {
            rows: toRows<R>(resultSet),
        };
        out.numAffectedRows = BigInt(resultSet.rowsAffected);
        if (resultSet.lastInsertRowid !== undefined && resultSet.lastInsertRowid !== null) {
            out.insertId = BigInt(resultSet.lastInsertRowid);
        }
        return out as QueryResult<R>;
    }

    async *streamQuery<R>(compiledQuery: CompiledQuery): AsyncIterableIterator<QueryResult<R>> {
        yield await this.executeQuery<R>(compiledQuery);
    }
}
