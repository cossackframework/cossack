/**
 * Write batches: several record writes that commit together in one RomeDB request, or not at
 * all, under guards that count other records in the same request. Each write is prepared as it
 * would be alone (access, validation, write filters); every condition the batch needs (the
 * guards, each record still as it was read, a membership) becomes a `cms_assertions` row whose
 * CHECK rolls the whole request back when it does not hold.
 */
import { ClientError, MAX_STATEMENTS, RequestTooLargeError, statementBytes, UncertainWriteError, type Statement } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import type { RecordShape } from '../records';
import { assertionStatements, isAssertionFailure, type BatchGuard, type BatchWrite, type OperationContext, type PreparedWrite } from './repository';
import type { CmsHost } from './host';

/** Writes and guards one batch takes. */
export const BATCH_LIMITS = Object.freeze({ writes: 10, guards: 10 });

/** The resource a batch write names. */
export function batchResource(write: BatchWrite): string {
    return 'create' in write ? write.create : 'update' in write ? write.update : write.delete;
}

/** What a batch refused names: a guard by its name, or a record by `<resource>:<id>`. */
interface Condition {
    readonly name: string;
    readonly kind: 'guard' | 'record' | 'member';
    readonly statement: Statement;
}

/**
 * Run the writes in order, in one request: every one commits, or none does. Returns each
 * write's record as the principal reads it (null for a delete). Refusals: `CMS_CONFLICT` when
 * a guard does not hold or a record changed since it was read (`fields` names them),
 * `CMS_FORBIDDEN` for a membership the principal lacks, and what each write refuses alone.
 */
export async function writeBatch(host: CmsHost, writes: readonly BatchWrite[], context: OperationContext & { readonly guards?: readonly BatchGuard[] }): Promise<(RecordShape | null)[]> {
    if (!Array.isArray(writes) || writes.length < 1 || writes.length > BATCH_LIMITS.writes) throw new CmsError('CMS_VALIDATION', `A batch has 1-${BATCH_LIMITS.writes} writes.`);
    const guards = context.guards ?? [];
    if (!Array.isArray(guards) || guards.length > BATCH_LIMITS.guards) throw new CmsError('CMS_VALIDATION', `A batch has at most ${BATCH_LIMITS.guards} guards.`);
    const names = new Set<string>();
    for (const guard of guards) {
        if (!guard || typeof guard.name !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(guard.name) || names.has(guard.name)) throw new CmsError('CMS_VALIDATION', 'Each guard needs a distinct name of letters, digits, dots, colons, underscores or hyphens.');
        names.add(guard.name);
    }
    // A record written twice would be checked against its first state only.
    const touched = new Set<string>();
    for (const write of writes) {
        if (!write || typeof write !== 'object') throw new CmsError('CMS_VALIDATION', 'A write creates, updates or deletes a record.');
        const id = 'create' in write ? write.id : write.id;
        if (id === undefined) continue;
        const key = `${batchResource(write)}:${id}`;
        if (touched.has(key)) throw new CmsError('CMS_VALIDATION', `A batch writes ${key} once.`);
        touched.add(key);
    }
    const prepared: PreparedWrite[] = [];
    for (const write of writes) prepared.push(await host.resource(batchResource(write)).prepare(write, context));
    const conditions: Condition[] = [
        ...guards.map(guard => ({ name: guard.name, kind: 'guard' as const, statement: host.resource(guard.resource).guardCondition(guard) })),
        ...prepared.flatMap(write => [
            ...(write.precondition ? [{ name: `${write.resource}:${write.id}`, kind: 'record' as const, statement: write.precondition }] : []),
            ...write.assertions.map(statement => ({ name: `${write.resource}:${write.id}`, kind: 'member' as const, statement })),
        ]),
    ];
    // The first write's operation ID names the request: its audit row is how recovery knows the batch committed.
    const op = prepared[0]!.op;
    const assertions = assertionStatements(conditions.map(condition => condition.statement), op);
    const statements = [...assertions.insert, ...prepared.flatMap(write => write.statements), ...assertions.remove];
    if (statements.length > MAX_STATEMENTS || statementBytes(statements) > await host.db.maxRequestBytes() - 2048) {
        throw new CmsError('CMS_LIMIT', 'These changes are too large for one batch. Make fewer at a time.');
    }
    try {
        await host.db.write(statements, { requestId: op, kind: 'cms.resource.write', ...(context.signal ? { signal: context.signal } : {}), workLimits: host.writeLimits });
    } catch (error) {
        if (error instanceof RequestTooLargeError) throw new CmsError('CMS_LIMIT', 'These changes are too large for one batch. Make fewer at a time.', { cause: error });
        if (error instanceof UncertainWriteError) throw new CmsError('CMS_UNCERTAIN', 'The changes were sent but not confirmed. They will be completed or reported shortly.', { requestId: error.requestId, cause: error });
        if (error instanceof ClientError && error.outcome === 'rolled-back') {
            if (isAssertionFailure(error)) throw await refusal(host, conditions, context, error);
            if (error.code === 'RDB_WRITE_CONFLICT') throw new CmsError('CMS_CONFLICT', 'A record changed while the batch ran. Reload and try again.', { cause: error });
            if (error.code === 'RDB_LIMIT') throw new CmsError('CMS_LIMIT', 'These changes are too large for one write. Make them in smaller steps.', { cause: error });
            if (error.code === 'RDB_CONSTRAINT') throw new CmsError('CMS_CONFLICT', 'A record with the same ID or unique value already exists.', { cause: error });
            if (error.code === 'RDB_VALIDATION') throw new CmsError('CMS_VALIDATION', 'The database rejected the values.', { cause: error });
        }
        throw error;
    }
    host.outboxWritten();
    return prepared.map(write => write.record);
}

/**
 * Which conditions did not hold, read again after the refusal: the batch reports them by name.
 * A condition that changed back since is not named; the refusal stands.
 */
async function refusal(host: CmsHost, conditions: readonly Condition[], context: OperationContext, cause: ClientError): Promise<CmsError> {
    let failed: Condition[] = [];
    try {
        const result = await host.db.read(conditions.map(condition => ({ ...condition.statement, rql: `SELECT CASE WHEN ${condition.statement.rql} THEN 1 ELSE 0 END` })), {
            ...(context.signal ? { signal: context.signal } : {}), workLimits: host.readLimits,
        });
        failed = conditions.filter((_, index) => Number(result.results[index]!.rows[0]?.[0] ?? 0) !== 1);
    } catch { /* the refusal stands without names */ }
    if (failed.some(condition => condition.kind === 'member') && failed.every(condition => condition.kind === 'member')) {
        return new CmsError('CMS_FORBIDDEN', 'A record of the batch is somewhere you are not a member.', { cause, fields: Object.fromEntries(failed.map(condition => [condition.name, 'is not yours to write there.'])) });
    }
    const fields = Object.fromEntries(failed.map(condition => [condition.name, condition.kind === 'guard' ? 'does not hold.' : condition.kind === 'record' ? 'changed since it was read.' : 'is not yours to write there.']));
    const message = failed.length ? `The batch was not written: ${failed.map(condition => condition.name).join(', ')} ${failed.length === 1 ? 'does' : 'do'} not hold.` : 'The batch was not written: a condition did not hold.';
    return new CmsError('CMS_CONFLICT', message, { cause, ...(failed.length ? { fields } : {}) });
}
