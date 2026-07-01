// src/types.ts

/**
 * The database schema. Each property maps a table name to its row type.
 *
 * Empty by default. Augment it from your model files (`src/models/*.ts`) so
 * `db.selectFrom('users')` is fully typed:
 *
 * ```ts
 * declare module '@cossackframework/database' {
 *   interface Database {
 *     users: UserRow
 *     sessions: SessionRow
 *   }
 * }
 * ```
 */
export interface Database {}

/** A Kysely client typed against the (augmented) {@link Database}. */
export type DbClient = import('kysely').Kysely<Database>;

// ---------------------------------------------------------------------------
// D1 binding (structural — compatible with Cloudflare's `D1Database`)
// ---------------------------------------------------------------------------

export interface D1DatabaseLike {
    prepare(query: string): D1PreparedStatementLike;
}

export interface D1PreparedStatementLike {
    bind(...values: unknown[]): D1PreparedStatementLike;
    all<T = unknown>(): Promise<D1ResultLike<T>>;
    run<T = unknown>(): Promise<D1ResultLike<T>>;
    first<T = unknown>(col?: string): Promise<T | null>;
}

export interface D1ResultLike<T = unknown> {
    results?: T[];
    success: boolean;
    meta?: {
        changes?: number;
        last_row_id?: number | string | null;
        [key: string]: unknown;
    };
}

// ---------------------------------------------------------------------------
// libSQL / Turso client (structural — compatible with `@libsql/client` and
// `@tursodatabase/serverless/compat`)
// ---------------------------------------------------------------------------

export interface LibsqlClientLike {
    execute(stmt: LibsqlInStatement): Promise<LibsqlResultSetLike>;
    close?(): void;
}

/**
 * Loose statement shape — `args` is forwarded to the underlying client
 * verbatim, so we type it broadly. The `| string` member mirrors libSQL's
 * `InStatement` so a real `@libsql/client` / `@tursodatabase/serverless` client
 * is structurally assignable to {@link LibsqlClientLike}.
 */
export type LibsqlInStatement =
    | { sql: string; args?: ReadonlyArray<unknown> | Record<string, unknown> }
    | string;

export interface LibsqlResultSetLike {
    columns: string[];
    rows: Array<LibsqlRowLike>;
    rowsAffected: number;
    lastInsertRowid?: bigint | number | undefined;
}

export interface LibsqlRowLike {
    length: number;
    [index: number]: unknown;
    [name: string]: unknown;
}

// ---------------------------------------------------------------------------
// Factory config
// ---------------------------------------------------------------------------

export interface D1Config {
    dialect: 'd1';
    /** A Cloudflare D1 binding (e.g. `env.DB`). */
    binding: D1DatabaseLike;
}

export interface LibsqlConfig {
    dialect: 'libsql';
    /**
     * A libSQL/Turso client. Build it from whichever package you installed:
     *
     * ```ts
     * // recommended (fetch-based, works on Workers + Node)
     * import { createClient } from '@tursodatabase/serverless/compat'
     * // or the battle-tested fallback
     * import { createClient } from '@libsql/client/web'
     *
     * const client = createClient({ url: env.TURSO_URL, authToken: env.TURSO_TOKEN })
     * ```
     */
    client: LibsqlClientLike;
}

export type DbConfig = D1Config | LibsqlConfig;
