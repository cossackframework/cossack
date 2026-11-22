// RomeDB as the database of the Cossack ORM (`@cossackframework/database`).
import {
    romedb as adapter,
    romedbClient as client,
    type RomeDBAdapterOptions,
} from '@cossackframework/database/romedb';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Adapter, ORM } from '@cossackframework/database';
import { createAsyncLocalScope } from '@cossackframework/database/adapter';
import { Float64, Record as RecordId } from '@romedb/client';
import type { RomeDB } from './database';

export { RecordLink, isRecordLink, type RecordKey } from '@cossackframework/database/romedb';

export type RomeDBOrmOptions = Omit<RomeDBAdapterOptions, 'values'>;

/**
 * An ORM adapter on a RomeDB instance. Relational entities are SQLite-dialect tables and
 * `@Entity({ model: 'document' })` entities are document tables. Each ORM statement is one
 * request; an ORM batch is one atomic write. There are no interactive transactions.
 *
 * ```ts
 * const orm = createORM({ adapter: await romedb(db), entities });
 * ```
 */
export async function romedb(db: RomeDB, options: RomeDBOrmOptions = {}): Promise<Adapter> {
    // For the ORM's commands: a file or a loopback service is the local database.
    const local = !/^https?:\/\//i.test(db.url) || /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(db.url);
    const created = await adapter(db, { tooling: { provider: 'romedb', target: local ? 'local' : 'remote' }, ...options, values: { RecordId, Float64 } });
    // Each request keeps its own scope, also while several ORMs (one per database) are open.
    return { ...created, scope: createAsyncLocalScope(new AsyncLocalStorage()) };
}

/**
 * The RomeDB instance an ORM runs on, for RomeQL the ORM does not write: record links,
 * graph traversal, vectors and search. Without an argument it is the ORM of the current scope.
 */
export function romedbClient(orm?: ORM): RomeDB {
    return client<RomeDB>(orm);
}
