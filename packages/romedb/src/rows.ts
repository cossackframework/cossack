import type { BatchResult, QueryResult } from './client';
import type { Value } from './values';

export type Row = { [column: string]: Value };

/** Columns repeat when a query projects the same name twice. Rows are positional; alias the duplicates. */
export class DuplicateColumnError extends Error {
    readonly columns: string[];
    constructor(columns: string[]) {
        super(`Query result repeats column ${columns.map(name => JSON.stringify(name)).join(', ')}; alias the duplicates before mapping rows to objects.`);
        this.name = 'DuplicateColumnError';
        this.columns = columns;
    }
}

export class CardinalityError extends Error {
    constructor(expected: string, actual: number) {
        super(`Expected ${expected} row, got ${actual}.`);
        this.name = 'CardinalityError';
    }
}

/** Map positional rows to objects by column name. Duplicate names are an error, never collapsed. */
export function objects<T extends Row = Row>(result: QueryResult): T[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const name of result.columns) (seen.has(name) ? duplicates : seen).add(name);
    if (duplicates.size) throw new DuplicateColumnError([...duplicates]);
    return result.rows.map(row => {
        const object: Row = {};
        result.columns.forEach((name, index) => { object[name] = row[index]!; });
        return object as T;
    });
}

export function first<T extends Row = Row>(result: QueryResult): T | undefined {
    return result.rows.length ? objects<T>({ ...result, rows: [result.rows[0]!] })[0] : undefined;
}

export function one<T extends Row = Row>(result: QueryResult): T {
    if (result.rows.length !== 1) throw new CardinalityError('exactly one', result.rows.length);
    return objects<T>(result)[0]!;
}

/** The single value of a one-row, one-column result. */
export function scalar(result: QueryResult): Value {
    if (result.rows.length !== 1 || result.columns.length !== 1) throw new CardinalityError('exactly one single-column', result.rows.length);
    return result.rows[0]![0]!;
}

/** Affected rows of one statement in a batch, as a number. */
export function affected(batch: BatchResult, statement: number): number {
    const result = batch.results[statement];
    if (!result) throw new RangeError(`batch has no statement ${statement}`);
    return Number(result.affected);
}
