import type { FastDB, WriteCallOptions } from './database';
import { Float64, RecordId, type Value } from './values';

type Bindable = string | number | null | bigint | boolean;

export interface SqlStatement {
    bind(...values: Bindable[]): SqlBound;
}

export interface SqlBound {
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results: T[] }>;
    run(): Promise<{ meta: { changes?: number } }>;
}

/** D1's `prepare().bind()` shape, as used by the portable SQL ledgers in `@cossackframework/core`. */
export interface SqlDatabase {
    prepare(sql: string): SqlStatement;
}

export interface SqlDatabaseOptions {
    /** Pending-write label for reconciliation. Default `sql`. */
    kind?: string;
    signal?: AbortSignal;
}

/**
 * A D1-shaped facade over relational FastDB tables. Each call is one request: SELECT and
 * WITH statements read a fresh snapshot, everything else is one atomic write whose
 * affected count is reported as `meta.changes`. Integer results that fit become numbers.
 */
export function sqlDatabase(db: FastDB, options: SqlDatabaseOptions = {}): SqlDatabase {
    return {
        prepare(sql: string): SqlStatement {
            const text = numberPlaceholders(sql);
            const reading = /^\s*(?:SELECT|WITH)\b/i.test(sql) && !/\bRETURNING\b/i.test(sql);
            return {
                bind(...values: Bindable[]): SqlBound {
                    const params: { [key: string]: Value } = {};
                    values.forEach((value, index) => { params[`$p${index + 1}`] = value as Value; });
                    const statement = values.length ? { sql: text, params } : { sql: text };
                    // A rolled-back write conflict re-runs as if the writes were serial.
                    const call: WriteCallOptions = { kind: options.kind ?? 'sql', retryConflicts: 5, ...(options.signal ? { signal: options.signal } : {}) };
                    const execute = () => reading ? db.read([statement], call) : db.write([statement], call);
                    const rows = async () => {
                        const result = (await execute()).results[0]!;
                        return result.rows.map(row => Object.fromEntries(result.columns.map((name, index) => [name, plain(row[index]!)])));
                    };
                    return {
                        async first<T>() { return ((await rows())[0] ?? null) as T | null; },
                        async all<T>() { return { results: await rows() as T[] }; },
                        async run() { return { meta: { changes: Number((await execute()).results[0]!.affected) } }; },
                    };
                },
            };
        },
    };
}

/** Rewrite positional `?` placeholders to `$p1..$pn`, leaving quoted text alone. */
export function numberPlaceholders(sql: string): string {
    let out = '';
    let index = 0;
    for (let i = 0; i < sql.length; i++) {
        const char = sql[i]!;
        if (char === "'" || char === '"') {
            const end = closing(sql, i, char);
            out += sql.slice(i, end + 1);
            i = end;
        } else if (char === '?') out += `$p${++index}`;
        else out += char;
    }
    return out;
}

function closing(sql: string, start: number, quote: string): number {
    for (let i = start + 1; i < sql.length; i++) {
        if (sql[i] === quote) {
            if (sql[i + 1] === quote) { i++; continue; }
            return i;
        }
    }
    return sql.length - 1;
}

function plain(value: Value): unknown {
    if (typeof value === 'bigint') return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
    if (value instanceof Float64) return value.value;
    if (value instanceof RecordId) return value.toString();
    return value;
}
