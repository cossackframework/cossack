// src/dialects/d1.ts
import {
    SqliteAdapter,
    SqliteQueryCompiler,
    sql,
} from 'kysely';
import type {
    CompiledQuery,
    DatabaseConnection,
    DatabaseMetadataOptions,
    DatabaseIntrospector,
    Dialect,
    Driver,
    Kysely,
    QueryResult,
    TableMetadata,
} from 'kysely';
import {
    DEFAULT_MIGRATION_LOCK_TABLE,
    DEFAULT_MIGRATION_TABLE,
} from 'kysely/migration';
import type { D1DatabaseLike } from '../types';

/**
 * Kysely's SQLite behavior with an explicit, duplicate-install-safe D1 brand.
 *
 * Consumers should inspect `cossackDialect` instead of relying on
 * `instanceof` or constructor names, which can change across package copies
 * and build tools.
 */
export class D1Adapter extends SqliteAdapter {
    readonly cossackDialect = 'd1' as const;
}

/**
 * Kysely {@link Dialect} for Cloudflare D1.
 *
 * Uses Kysely's SQLite query compiler/adapter/introspector and a custom driver
 * that talks to the `D1Database` binding (`prepare().bind().all()`). No extra
 * runtime dependencies — the D1 binding is provided by the Workers runtime.
 *
 * Note: D1 does not support interactive (`BEGIN`/`COMMIT`) transactions. For
 * atomic multi-statement writes, use the raw D1 binding's `.batch([...])`
 * (e.g. `c.env.DB.batch([...])` with prepared statements) — Kysely has no
 * `.batch()`. Kysely's migrator is unaffected because the SQLite adapter
 * reports `supportsTransactionalDdl: false`.
 */
export class D1Dialect implements Dialect {
    constructor(private readonly d1: D1DatabaseLike) {}

    createDriver(): Driver {
        return new D1Driver(this.d1);
    }
    createQueryCompiler(): SqliteQueryCompiler {
        return new SqliteQueryCompiler();
    }
    createAdapter(): D1Adapter {
        return new D1Adapter();
    }
    createIntrospector(db: Kysely<any>): DatabaseIntrospector {
        return new D1Introspector(db);
    }
}

interface D1TableRow {
    name: string;
    sql: string | null;
    type: 'table' | 'view';
}

interface D1ColumnRow {
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
}

/**
 * D1 stores a protected `_cf_METADATA` table beside application tables.
 * Kysely's stock SQLite introspector feeds every non-`sqlite_*` table into
 * `pragma_table_info()`, which includes `_cf_METADATA`; D1 rejects inspection
 * of that internal table with `SQLITE_AUTH`. Query application tables first,
 * explicitly excluding `_cf_*`, then introspect each safe name separately.
 */
class D1Introspector implements DatabaseIntrospector {
    constructor(private readonly db: Kysely<any>) {}

    async getSchemas(): Promise<[]> {
        return [];
    }

    async getTables(
        options: DatabaseMetadataOptions = { withInternalKyselyTables: false },
    ): Promise<TableMetadata[]> {
        let query = this.db
            .selectFrom('sqlite_master')
            .where('type', 'in', ['table', 'view'])
            .where('name', 'not like', 'sqlite_%')
            .where(sql<boolean>`name not glob ${'_cf_*'}`)
            .select(['name', 'sql', 'type'])
            .orderBy('name');

        if (!options.withInternalKyselyTables) {
            query = query
                .where('name', '!=', DEFAULT_MIGRATION_TABLE)
                .where('name', '!=', DEFAULT_MIGRATION_LOCK_TABLE);
        }

        const tables = await query.execute() as D1TableRow[];
        return Promise.all(tables.map(async (table): Promise<TableMetadata> => {
            const result = await sql<D1ColumnRow>`
                select * from pragma_table_info(${table.name})
            `.execute(this.db);
            const columns = result.rows;
            const autoIncrementColumn = findAutoIncrementColumn(table.sql, columns);
            return {
                name: table.name,
                isView: table.type === 'view',
                isForeign: false,
                columns: columns.map((column) => ({
                    name: column.name,
                    dataType: column.type,
                    isNullable: !column.notnull,
                    isAutoIncrementing: column.name === autoIncrementColumn,
                    hasDefaultValue: column.dflt_value != null,
                    comment: undefined,
                })),
            };
        }));
    }
}

function findAutoIncrementColumn(
    tableSql: string | null,
    columns: D1ColumnRow[],
): string | undefined {
    const declared = tableSql
        ?.split(/[\(\),]/)
        .find((part) => part.toLowerCase().includes('autoincrement'))
        ?.trimStart()
        .split(/\s+/)[0]
        ?.replace(/["`]/g, '');
    if (declared) return declared;

    const primaryKeys = columns.filter((column) => column.pk > 0);
    if (primaryKeys.length === 1 &&
        primaryKeys[0].type.toLowerCase() === 'integer') {
        return primaryKeys[0].name;
    }
    return undefined;
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
            'D1 does not support interactive transactions. For atomic multi-statement writes, use the raw D1 binding (.batch([...]), e.g. c.env.DB.batch([...])) — Kysely has no .batch().',
        );
    }
    async commitTransaction(): Promise<void> {
        throw new Error(
            'D1 does not support interactive transactions. For atomic multi-statement writes, use the raw D1 binding (.batch([...]), e.g. c.env.DB.batch([...])) — Kysely has no .batch().',
        );
    }
    async rollbackTransaction(): Promise<void> {
        throw new Error(
            'D1 does not support interactive transactions. For atomic multi-statement writes, use the raw D1 binding (.batch([...]), e.g. c.env.DB.batch([...])) — Kysely has no .batch().',
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
