import { validatePrepared, type PreparedWrite } from './client';

/** A saved write persisted before dispatch, so an uncertain outcome can be recovered by exact body. */
export interface PendingWrite {
    readonly request: PreparedWrite;
    /** Unix milliseconds when the write was saved. */
    readonly savedAt: number;
    /** Application label for reconciliation, such as `cms.resource.update`. */
    readonly kind?: string;
}

/**
 * Durable storage for writes that have been prepared but not confirmed.
 * `put` must be durable when it resolves and must refuse to replace a different body.
 */
export interface PendingWriteStore {
    readonly durability: 'process' | 'durable';
    put(id: string, write: PendingWrite): Promise<void>;
    get(id: string): Promise<PendingWrite | undefined>;
    delete(id: string): Promise<void>;
    /** Oldest first. */
    list(options?: { limit?: number }): Promise<readonly PendingWrite[]>;
}

export class PendingWriteConflictError extends Error {
    constructor(id: string) {
        super(`A different pending write is already saved as ${id}.`);
        this.name = 'PendingWriteConflictError';
    }
}

/** Serialize a pending write as stored text. */
export function encodePendingWrite(write: PendingWrite): string {
    validatePrepared(write.request);
    return JSON.stringify({ version: 1, savedAt: write.savedAt, ...(write.kind === undefined ? {} : { kind: write.kind }), request: write.request });
}

/** Parse stored text, validating the saved request envelope. */
export function decodePendingWrite(stored: string): PendingWrite {
    const value = JSON.parse(stored) as { version?: unknown; savedAt?: unknown; kind?: unknown; request?: unknown };
    if (value.version !== 1 || !Number.isSafeInteger(value.savedAt) || (value.kind !== undefined && typeof value.kind !== 'string')) throw new TypeError('invalid pending write');
    validatePrepared(value.request);
    return Object.freeze({ request: Object.freeze(value.request as PreparedWrite), savedAt: value.savedAt as number, ...(value.kind === undefined ? {} : { kind: value.kind as string }) });
}

export function samePendingWrite(a: PendingWrite, b: PendingWrite): boolean {
    return a.request.body === b.request.body && a.request.url === b.request.url && a.request.databaseId === b.request.databaseId && a.request.queryVersion === b.request.queryVersion;
}

/** Process memory. For tests and single-process development only. */
export class MemoryPendingWriteStore implements PendingWriteStore {
    readonly durability = 'process' as const;
    readonly #writes = new Map<string, string>();

    async put(id: string, write: PendingWrite): Promise<void> {
        const stored = encodePendingWrite(write);
        const existing = this.#writes.get(id);
        if (existing !== undefined && !samePendingWrite(decodePendingWrite(existing), write)) throw new PendingWriteConflictError(id);
        this.#writes.set(id, stored);
    }

    async get(id: string): Promise<PendingWrite | undefined> {
        const stored = this.#writes.get(id);
        return stored === undefined ? undefined : decodePendingWrite(stored);
    }

    async delete(id: string): Promise<void> {
        this.#writes.delete(id);
    }

    async list(options: { limit?: number } = {}): Promise<readonly PendingWrite[]> {
        const writes = [...this.#writes.values()].map(decodePendingWrite).sort((a, b) => a.savedAt - b.savedAt);
        return writes.slice(0, options.limit ?? writes.length);
    }
}
