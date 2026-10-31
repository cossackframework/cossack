import { afterAll, beforeAll } from 'vitest';
import { createRomeDB, MemoryPendingWriteStore, type RomeDB, type RomeDBOptions } from '@cossackframework/romedb';
import { liveRomeDBTests, startRomeDBService, type RomeDBTestService } from '@cossackframework/romedb/testing';
import { cmsReconcilers } from '../src/server/index';

export const live = liveRomeDBTests();

/** One local RomeDB service per test file. Each `database()` call opens a new binding to it. */
export function romedbService() {
    let service: RomeDBTestService | undefined;
    const bindings: RomeDB[] = [];
    beforeAll(async () => { service = await startRomeDBService(); }, 30_000);
    afterAll(async () => {
        await Promise.all(bindings.splice(0).map(binding => binding.close()));
        await service?.stop();
    });
    return {
        get url() { return service!.url; },
        get token() { return service!.token; },
        database(options: Partial<RomeDBOptions> = {}): RomeDB {
            const db = createRomeDB({ url: service!.url, token: service!.token, pending: new MemoryPendingWriteStore(), reconcilers: cmsReconcilers(), ...options });
            bindings.push(db);
            return db;
        },
        /** A separate fresh service, for comparing plans across databases. */
        async fresh(): Promise<{ db: RomeDB; stop(): Promise<void> }> {
            const other = await startRomeDBService();
            const db = createRomeDB({ url: other.url, token: other.token, pending: new MemoryPendingWriteStore() });
            return { db, stop: async () => { await db.close(); await other.stop(); } };
        },
    };
}
