import { decodePendingWrite, encodePendingWrite, pagePendingWrites, PendingWriteConflictError, samePendingWrite, type PendingCursor, type PendingListOptions, type PendingWrite, type PendingWriteStore } from './pending';

/** Structural Durable Object types, so the package does not need Workers ambient types. */
interface DurableObjectStorageLike {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<boolean>;
    list<T>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>>;
    transaction<T>(closure: (txn: DurableObjectStorageLike) => Promise<T>): Promise<T>;
}
interface DurableObjectStateLike { storage: DurableObjectStorageLike }
interface DurableObjectStubLike { fetch(input: string | Request, init?: RequestInit): Promise<Response> }
export interface DurableObjectNamespaceLike {
    idFromName(name: string): unknown;
    get(id: never): DurableObjectStubLike;
}

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const PREFIX = 'pending:';

/**
 * Durable Object that holds pending RomeDB writes. Export it from the Worker entry and bind it,
 * for example as `ROMEDB_PENDING`. Storage writes are durable before the response returns.
 */
export class RomeDBPendingWrites {
    readonly #storage: DurableObjectStorageLike;

    constructor(state: DurableObjectStateLike) {
        this.#storage = state.storage;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const id = url.searchParams.get('id') ?? '';
        try {
            if (request.method === 'GET' && url.pathname === '/list') {
                const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 1000);
                const entries = await this.#storage.list<string>({ prefix: PREFIX });
                const after = url.searchParams.get('afterId');
                const cursor: PendingCursor | undefined = after === null ? undefined : { savedAt: Number(url.searchParams.get('afterSavedAt')), id: after };
                const writes = pagePendingWrites([...entries.values()].map(decodePendingWrite), { limit, ...(cursor ? { after: cursor } : {}) });
                return Response.json(writes.map(encodePendingWrite));
            }
            if (!ID.test(id)) return Response.json({ error: 'invalid id' }, { status: 400 });
            const key = PREFIX + id;
            if (request.method === 'GET') {
                const stored = await this.#storage.get<string>(key);
                return stored === undefined ? new Response(null, { status: 404 }) : Response.json(stored);
            }
            if (request.method === 'PUT') {
                const stored = await request.text();
                const write = decodePendingWrite(stored);
                const conflict = await this.#storage.transaction(async txn => {
                    const existing = await txn.get<string>(key);
                    if (existing !== undefined) return !samePendingWrite(decodePendingWrite(existing), write);
                    await txn.put(key, stored);
                    return false;
                });
                return conflict ? Response.json({ error: 'conflict' }, { status: 409 }) : new Response(null, { status: 204 });
            }
            if (request.method === 'DELETE') {
                await this.#storage.delete(key);
                return new Response(null, { status: 204 });
            }
            return new Response(null, { status: 405 });
        } catch {
            return Response.json({ error: 'invalid pending write' }, { status: 400 });
        }
    }
}

/**
 * Objects a store spreads its writes across by request ID. Fixed: `get` and `delete` find a write
 * by hashing over this count and `list` reads exactly these objects, so changing it would strand
 * every saved write in an object no longer read.
 */
const SHARDS = 4;

/**
 * Pending write store backed by {@link RomeDBPendingWrites}. Writes spread across a fixed number
 * of objects by request ID; `list` reads every one.
 */
export class DurableObjectPendingWriteStore implements PendingWriteStore {
    readonly durability = 'durable' as const;
    readonly #namespace: DurableObjectNamespaceLike;
    readonly #name: string;

    constructor(namespace: DurableObjectNamespaceLike, options: { name?: string } = {}) {
        this.#namespace = namespace;
        this.#name = options.name ?? 'romedb';
    }

    async put(id: string, write: PendingWrite): Promise<void> {
        const response = await this.#stub(id).fetch(`https://pending/write?id=${encodeURIComponent(id)}`, { method: 'PUT', body: encodePendingWrite(write) });
        if (response.status === 409) throw new PendingWriteConflictError(id);
        if (!response.ok) throw new Error(`Pending write store rejected the write (${response.status}).`);
    }

    async get(id: string): Promise<PendingWrite | undefined> {
        const response = await this.#stub(id).fetch(`https://pending/write?id=${encodeURIComponent(id)}`);
        if (response.status === 404) return undefined;
        if (!response.ok) throw new Error(`Pending write store read failed (${response.status}).`);
        return decodePendingWrite(await response.json() as string);
    }

    async delete(id: string): Promise<void> {
        const response = await this.#stub(id).fetch(`https://pending/write?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(`Pending write store delete failed (${response.status}).`);
    }

    async list(options: PendingListOptions = {}): Promise<readonly PendingWrite[]> {
        const limit = options.limit ?? 100;
        const after = options.after ? `&afterSavedAt=${options.after.savedAt}&afterId=${encodeURIComponent(options.after.id)}` : '';
        const writes: PendingWrite[] = [];
        for (let shard = 0; shard < SHARDS; shard++) {
            const response = await this.#namespace.get(this.#namespace.idFromName(`${this.#name}:${shard}`) as never).fetch(`https://pending/list?limit=${limit}${after}`);
            if (!response.ok) throw new Error(`Pending write store list failed (${response.status}).`);
            writes.push(...(await response.json() as string[]).map(decodePendingWrite));
        }
        return pagePendingWrites(writes, { limit });
    }

    #stub(id: string): DurableObjectStubLike {
        if (!ID.test(id)) throw new TypeError('pending write id requires 1..80 letters, digits, underscores or hyphens');
        return this.#namespace.get(this.#namespace.idFromName(`${this.#name}:${shardOf(id, SHARDS)}`) as never);
    }
}

function shardOf(id: string, shards: number): number {
    let hash = 2166136261;
    for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
    return (hash >>> 0) % shards;
}
