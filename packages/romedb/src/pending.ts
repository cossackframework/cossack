import { validatePrepared, type PreparedWrite } from '@romedb/client';

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
    /** Oldest first (by `savedAt`, then request ID), after `after` when it is given. */
    list(options?: PendingListOptions): Promise<readonly PendingWrite[]>;
    /** IDs of saved writes the latest `list` could not read and left out, for the recovery report. */
    unreadable?(): readonly string[];
}

export interface PendingListOptions {
    limit?: number;
    /** Continue after this write, as {@link pendingCursor} gives it, to page past the oldest. */
    after?: PendingCursor;
}

/** A position in the oldest-first order of saved writes. */
export interface PendingCursor {
    readonly savedAt: number;
    readonly id: string;
}

export function pendingCursor(write: PendingWrite): PendingCursor {
    return { savedAt: write.savedAt, id: preparedRequestId(write.request) };
}

/** Sort saved writes oldest first, keep those after the cursor, and cut to the limit. */
export function pagePendingWrites(writes: readonly PendingWrite[], options: PendingListOptions = {}): PendingWrite[] {
    const keyed = writes.map(write => ({ write, cursor: pendingCursor(write) }));
    keyed.sort((a, b) => compareCursors(a.cursor, b.cursor));
    const after = options.after;
    const page = after ? keyed.filter(entry => compareCursors(entry.cursor, after) > 0) : keyed;
    return page.slice(0, options.limit ?? page.length).map(entry => entry.write);
}

function compareCursors(a: PendingCursor, b: PendingCursor): number {
    return a.savedAt - b.savedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
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
    return a.request.body === b.request.body && a.request.url === b.request.url && a.request.databaseId === b.request.databaseId && a.request.version === b.request.version && queryVersion(a.request) === queryVersion(b.request);
}

/** The request ID of a saved write. */
export function preparedRequestId(request: PreparedWrite): string {
    return validatePrepared(request).requestId;
}

function queryVersion(request: PreparedWrite): number | undefined {
    return request.version === 2 ? request.queryVersion : undefined;
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

    async list(options: PendingListOptions = {}): Promise<readonly PendingWrite[]> {
        return pagePendingWrites([...this.#writes.values()].map(decodePendingWrite), options);
    }
}
