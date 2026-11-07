import { afterAll, beforeAll } from 'vitest';
import { createRomeDB, MemoryPendingWriteStore, type RomeDB, type RomeDBOptions } from '@cossackframework/romedb';
import { liveRomeDBTests, startRomeDBService, type RomeDBTestService } from '@cossackframework/romedb/testing';
import { cmsReconcilers } from '../src/server/index';
import type { StorageProvider } from '@cossackframework/core/storage';

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

/** An in-memory storage provider for file tests. */
export function memoryStorage(): StorageProvider & { objects: Map<string, Uint8Array> } {
    const objects = new Map<string, Uint8Array>();
    return {
        name: 'memory', objects,
        async put(key, body, options) { objects.set(key, new Uint8Array(await new Response(body).arrayBuffer())); return { key, size: options.size }; },
        async get(key) { const bytes = objects.get(key); return bytes ? { key, size: bytes.length, body: new Response(bytes.slice().buffer as ArrayBuffer).body! } : null; },
        async head(key) { const bytes = objects.get(key); return bytes ? { key, size: bytes.length } : null; },
        async delete(key) { objects.delete(key); },
    };
}

/** A PNG header of the given size: enough for the signature check and the dimensions. */
export function pngBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 0, 0, 0, 0, 0, 8, 2, 0, 0, 0]);
    new DataView(bytes.buffer).setUint32(16, width);
    new DataView(bytes.buffer).setUint32(20, height);
    return bytes;
}
