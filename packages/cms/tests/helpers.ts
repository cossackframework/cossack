import { afterAll, beforeAll } from 'vitest';
import { createFastDB, MemoryPendingWriteStore, type FastDB, type FastDBOptions } from '@cossackframework/fastdb';
import { liveFastDBTests, startFastDBService, type FastDBTestService } from '@cossackframework/fastdb/testing';
import { cmsReconcilers } from '../src/server/index';

export const live = liveFastDBTests();

/** One local FastDB service per test file. Each `database()` call opens a new binding to it. */
export function fastdbService() {
    let service: FastDBTestService | undefined;
    const bindings: FastDB[] = [];
    beforeAll(async () => { service = await startFastDBService(); }, 30_000);
    afterAll(async () => {
        await Promise.all(bindings.splice(0).map(binding => binding.close()));
        await service?.stop();
    });
    return {
        get url() { return service!.url; },
        get token() { return service!.token; },
        database(options: Partial<FastDBOptions> = {}): FastDB {
            const db = createFastDB({ url: service!.url, token: service!.token, pending: new MemoryPendingWriteStore(), reconcilers: cmsReconcilers(), ...options });
            bindings.push(db);
            return db;
        },
        /** A separate fresh service, for comparing plans across databases. */
        async fresh(): Promise<{ db: FastDB; stop(): Promise<void> }> {
            const other = await startFastDBService();
            const db = createFastDB({ url: other.url, token: other.token, pending: new MemoryPendingWriteStore() });
            return { db, stop: async () => { await db.close(); await other.stop(); } };
        },
    };
}
