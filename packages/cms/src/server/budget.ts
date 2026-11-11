/**
 * What one RomeDB request holds, from the binding: its statement count and its size. Code that
 * batches statements cuts them here instead of hardcoding the numbers.
 */
import { ClientError, MAX_STATEMENTS, statementBytes, type RomeDB, type Statement } from '@cossackframework/romedb';

type ReadOptions = NonNullable<Parameters<RomeDB['read']>[1]>;
type Row = Awaited<ReturnType<RomeDB['read']>>['results'][number]['rows'][number];

/** Room a request needs besides its statements: its identity and work limits. */
export const REQUEST_ROOM = 2048;

/**
 * Cut statements into requests that fit this database. `group` statements stay together (a
 * pair that must not be split); `reserve` statements are left free in every request for ones
 * the caller adds. A single group too large for a request is still sent alone, and RomeDB
 * refuses it.
 */
export async function requestBatches(db: RomeDB, statements: readonly Statement[], options: { group?: number; reserve?: number } = {}): Promise<Statement[][]> {
    const group = Math.max(1, options.group ?? 1);
    const count = Math.max(group, MAX_STATEMENTS - (options.reserve ?? 0));
    const bytes = await db.maxRequestBytes() - REQUEST_ROOM;
    const batches: Statement[][] = [];
    let batch: Statement[] = [];
    let size = 0;
    for (let index = 0; index < statements.length; index += group) {
        const part = statements.slice(index, index + group);
        const partSize = statementBytes(part);
        if (batch.length && (batch.length + part.length > count || size + partSize > bytes)) { batches.push(batch); batch = []; size = 0; }
        batch.push(...part);
        size += partSize;
    }
    if (batch.length) batches.push(batch);
    return batches;
}

/** Statements to read in requests of at most `MAX_STATEMENTS` (less `reserve`), for reads that return little each. */
export function readBatches<T>(items: readonly T[], reserve = 0): T[][] {
    const count = MAX_STATEMENTS - reserve;
    const batches: T[][] = [];
    for (let index = 0; index < items.length; index += count) batches.push(items.slice(index, index + count));
    return batches;
}

/** Whether RomeDB refused a read because its result was over the result budget. */
export function isResultTooLarge(error: unknown): boolean {
    return error instanceof ClientError && error.code === 'RDB_LIMIT' && /result/i.test(error.message);
}

/**
 * Read up to `count` rows from `offset` with one statement that takes `$limit` and `$offset`,
 * in as few reads as the result budget allows: a page whose result is too large is read again
 * in halves. Later pages read at least as fresh as the first.
 */
export async function readPaged(db: RomeDB, statement: (limit: number, offset: number) => Statement, count: number, offset: number, options: ReadOptions = {}): Promise<Row[]> {
    const rows: Row[] = [];
    let size = count;
    let after = options.afterSequence;
    while (rows.length < count) {
        const want = Math.min(size, count - rows.length);
        let result: Awaited<ReturnType<RomeDB['read']>>;
        try { result = await db.read([statement(want, offset + rows.length)], { ...options, ...(after === undefined ? {} : { afterSequence: after }) }); }
        catch (error) {
            if (isResultTooLarge(error) && size > 1) { size = Math.ceil(size / 2); continue; }
            throw error;
        }
        after ??= result.sequence;
        const page = result.results[0]!.rows;
        rows.push(...page);
        if (page.length < want) break;
    }
    return rows;
}
