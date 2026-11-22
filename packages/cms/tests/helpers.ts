import { afterAll, beforeAll } from 'vitest';
import { ClientError, createRomeDB, LOCAL_REQUEST_BYTES, MemoryPendingWriteStore, RequestTooLargeError, RESULT_BYTES, statementBytes, type RomeDB, type RomeDBOptions } from '@cossackframework/romedb';
import { liveRomeDBTests, startRomeDBService, type RomeDBTestService } from '@cossackframework/romedb/testing';
import { cmsReconcilers, memoryPeople, type CmsHost } from '../src/server/index';
import type { StorageProvider } from '@cossackframework/core/storage';

export const live = liveRomeDBTests();

/** One local RomeDB service per test file. Each `database()` call opens a new binding to it. */
/**
 * The database as one with small budgets (64 KiB requests and 256 KiB of results, what an
 * engine that reports no limits has): the suites that test batching, size caps and paged reads
 * need requests and results to fill up. RomeDB 0.2.23 or later takes 8 MiB of each.
 */
export function smallRequests(db: RomeDB, bytes = LOCAL_REQUEST_BYTES, resultBytes = RESULT_BYTES): RomeDB {
    return new Proxy(db, {
        get(target, property) {
            if (property === 'maxRequestBytes') return async () => bytes;
            if (property === 'maxResultBytes') return async () => resultBytes;
            if (property === 'read') return async (statements: Parameters<RomeDB['read']>[0], ...rest: unknown[]) => {
                const result = await (target.read as (...args: unknown[]) => ReturnType<RomeDB['read']>).call(target, statements, ...rest);
                const size = new TextEncoder().encode(JSON.stringify(result.results, (_, value: unknown) => typeof value === 'bigint' ? String(value) : value)).length;
                if (size > resultBytes) throw new ClientError('RDB_LIMIT', `Result exceeds the result limit: ${size} bytes, over ${resultBytes}`, 'read-failed');
                return result;
            };
            if (property === 'write') return (statements: Parameters<RomeDB['write']>[0], ...rest: unknown[]) => {
                if (statementBytes(statements) > bytes) return Promise.reject(new RequestTooLargeError(new Error(`${statementBytes(statements)} bytes, over ${bytes}`)));
                return (target.write as (...args: unknown[]) => ReturnType<RomeDB['write']>).call(target, statements, ...rest);
            };
            const value = Reflect.get(target, property, target) as unknown;
            // The binding keeps private fields: its methods run on it, not on the proxy.
            return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
    });
}

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
        async fresh(): Promise<{ db: RomeDB; url: string; token: string; stop(): Promise<void> }> {
            const other = await startRomeDBService();
            const db = createRomeDB({ url: other.url, token: other.token, pending: new MemoryPendingWriteStore() });
            return { db, url: other.url, token: other.token, stop: async () => { await db.close(); await other.stop(); } };
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

/**
 * The users of a test network: the accounts the network shares are the main site's users, and
 * each added site has members of its own, which `join` copies from those accounts.
 */
export function networkPeople() {
    const main = memoryPeople();
    const sites = new Map<string, ReturnType<typeof memoryPeople>>();
    const of = (site: string): ReturnType<typeof memoryPeople> => {
        if (site === 'main') return main;
        if (!sites.has(site)) sites.set(site, memoryPeople({ network: main }));
        return sites.get(site)!;
    };
    return {
        main, of,
        /** The added sites an account is a member of, in ID order. */
        async memberSites(accountId: string): Promise<string[]> {
            const ids: string[] = [];
            for (const [site, people] of [...sites].sort(([a], [b]) => a < b ? -1 : 1)) if ((await people.getMany([accountId])).has(accountId)) ids.push(site);
            return ids;
        },
        /** An account on the main site that administers the network. */
        async admin(host: CmsHost, input: { email: string; name: string; roles?: readonly string[] }): Promise<string> {
            const user = await host.users.create(input);
            main.set(user.id, { networkAdmin: true });
            return user.id;
        },
    };
}
