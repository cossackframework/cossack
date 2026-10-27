import type { RomeDB, WriteCallOptions } from './database';
import { Float64, RecordId, type Value } from './values';

type Bindable = string | number | null | bigint | boolean;

export interface RqlStatement {
    bind(...values: Bindable[]): RqlBound;
}

export interface RqlBound {
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results: T[] }>;
    run(): Promise<{ meta: { changes?: number } }>;
}

/** D1's `prepare().bind()` shape, as used by the portable SQL ledgers in `@cossackframework/core`. */
export interface RqlDatabase {
    prepare(sql: string): RqlStatement;
}

export interface RqlDatabaseOptions {
    /** Pending-write label for reconciliation. Default `rql`. */
    kind?: string;
    signal?: AbortSignal;
}

/**
 * A D1-shaped facade over relational RomeDB tables. Each call is one request: SELECT and
 * WITH statements read a fresh snapshot, everything else is one atomic write whose
 * affected count is reported as `meta.changes`. Integer results that fit become numbers.
 */
export function rqlDatabase(db: RomeDB, options: RqlDatabaseOptions = {}): RqlDatabase {
    return {
        prepare(sql: string): RqlStatement {
            const text = numberPlaceholders(sql);
            const reading = /^\s*(?:SELECT|WITH)\b/i.test(sql) && !/\bRETURNING\b/i.test(sql);
            return {
                bind(...values: Bindable[]): RqlBound {
                    const params: { [key: string]: Value } = {};
                    values.forEach((value, index) => { params[`$p${index + 1}`] = value as Value; });
                    const statement = values.length ? { rql: text, params } : { rql: text };
                    // A rolled-back write conflict re-runs as if the writes were serial.
                    const call: WriteCallOptions = { kind: options.kind ?? 'rql', retryConflicts: 5, ...(options.signal ? { signal: options.signal } : {}) };
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
