import {
    ClientError,
    connectWithInfo,
    preparedRequestId,
    validatePrepared,
    type BatchResult,
    type ConnectOptions,
    type DatabaseInfo,
    type PreparedWrite,
    type RemoteDatabase,
    type RequestOptions,
    type Statement,
    type WarmResult,
    type WorkLimits,
} from './client';
import type { PendingWrite, PendingWriteStore } from './pending';

/** The RomeDB engine release this package targets. Older engines are refused at preflight. */
export const REQUIRED_ENGINE_VERSION = '0.2.9';

export interface RomeDBWorkLimits {
    /** Default budget for each read batch. */
    read: WorkLimits;
    /** Default budget for each write batch. */
    write: WorkLimits;
}

export interface RomeDBRetryOptions {
    /** Attempts for one call, including the first. Default 3. */
    attempts?: number;
    /** Upper bound for one backpressure delay. Default 2000 ms. */
    maxDelayMs?: number;
}

export interface RomeDBOptions {
    url: string;
    token: string;
    /** Writes are saved here before dispatch. Use a durable store in production. */
    pending: PendingWriteStore;
    /** Explicit default budgets. A call may lower or raise them within the service ceilings. */
    workLimits?: Partial<RomeDBWorkLimits>;
    /** Oldest acceptable engine release. Default {@link REQUIRED_ENGINE_VERSION}. */
    engineVersion?: string;
    timeoutMs?: number;
    retry?: RomeDBRetryOptions;
    fetch?: typeof globalThis.fetch;
    now?: () => number;
    /** Waits between retries; injectable for tests. */
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    /** Reconcilers by pending write kind, used when a write left the 64-request receipt window. */
    reconcilers?: { [kind: string]: Reconciler };
}

/**
 * Decide whether an unconfirmed write committed, from current data.
 * Return `committed` or `absent`; anything else keeps the write pending.
 */
export type Reconciler = (write: PendingWrite, db: RomeDB) => Promise<'committed' | 'absent' | 'unknown'>;

export interface ReadCallOptions extends RequestOptions {
    afterSequence?: number;
    workLimits?: WorkLimits;
}

export interface WriteCallOptions extends ReadCallOptions {
    /** Allocated by the caller before dispatch; doubles as the operation ID. */
    requestId?: string;
    ifSequence?: number;
    /** Reconciliation label stored with the pending write. */
    kind?: string;
    /**
     * Re-run a batch the engine rolled back for a concurrent write to the same rows
     * (`FDB_WRITE_CONFLICT`), up to this many times, as a new request. Use only when
     * re-evaluating the statements against newer data is correct. Default 0.
     */
    retryConflicts?: number;
}

export interface RecoveryReport {
    confirmed: string[];
    rolledBack: string[];
    reconciled: string[];
    pending: string[];
}

/** The engine is older than this package requires, or did not report its release. */
export class EngineVersionError extends Error {
    readonly engineVersion: string | undefined;
    readonly required: string;
    constructor(engineVersion: string | undefined, required: string) {
        super(engineVersion === undefined
            ? `The RomeDB engine did not report its release; RomeDB ${required} or later is required.`
            : `RomeDB engine ${engineVersion} is older than the required ${required}.`);
        this.name = 'EngineVersionError';
        this.engineVersion = engineVersion;
        this.required = required;
    }
}

/** A write was dispatched but its outcome is unknown. It stays saved for exact recovery. */
export class UncertainWriteError extends Error {
    readonly requestId: string;
    readonly request: PreparedWrite;
    readonly cause: unknown;
    constructor(request: PreparedWrite, cause: unknown) {
        super('The database write was sent but not confirmed. It is saved and will be recovered with the same request.');
        this.name = 'UncertainWriteError';
        this.requestId = preparedRequestId(request);
        this.request = request;
        this.cause = cause;
    }
}

const DEFAULT_LIMITS: RomeDBWorkLimits = {
    read: { rowsRead: 50_000, vmSteps: 2_000_000 },
    write: { rowsRead: 50_000, rowMutations: 1_000, vmSteps: 2_000_000 },
};

/**
 * One database binding per isolate or process. Calls are request-scoped through their
 * options: pass the request's AbortSignal and explicit budgets.
 */
export class RomeDB {
    readonly url: string;
    readonly pending: PendingWriteStore;
    readonly #options: RomeDBOptions;
    readonly #limits: RomeDBWorkLimits;
    readonly #required: string;
    readonly #attempts: number;
    readonly #maxDelay: number;
    readonly #sleep: NonNullable<RomeDBOptions['sleep']>;
    readonly #now: () => number;
    #client: Promise<RemoteDatabase> | undefined;
    #preflight: Promise<DatabaseInfo> | undefined;

    constructor(options: RomeDBOptions) {
        if (!options.pending) throw new TypeError('RomeDB requires a pending write store');
        this.#options = options;
        this.url = options.url;
        this.pending = options.pending;
        this.#limits = { read: { ...DEFAULT_LIMITS.read, ...options.workLimits?.read }, write: { ...DEFAULT_LIMITS.write, ...options.workLimits?.write } };
        this.#required = options.engineVersion ?? REQUIRED_ENGINE_VERSION;
        this.#attempts = options.retry?.attempts ?? 3;
        if (!Number.isInteger(this.#attempts) || this.#attempts < 1 || this.#attempts > 10) throw new RangeError('retry.attempts must be 1..10');
        this.#maxDelay = options.retry?.maxDelayMs ?? 2_000;
        this.#sleep = options.sleep ?? sleep;
        this.#now = options.now ?? Date.now;
    }

    /** Highest publication sequence this binding has confirmed. */
    async sequence(): Promise<number> {
        return (await this.#connection()).sequence;
    }

    /** Read database details and refuse an older or missing engine release. Memoized on success. */
    preflight(options: RequestOptions = {}): Promise<DatabaseInfo> {
        this.#preflight ??= this.#connection().then(async client => {
            const info = await client.info(options);
            checkEngine(info.engineVersion, this.#required);
            return info;
        });
        this.#preflight.catch(() => { this.#preflight = undefined; });
        return this.#preflight;
    }

    /** Fresh snapshot read with bounded backpressure retries. Reads are always safe to retry. */
    async read(statements: Statement[], options: ReadCallOptions = {}): Promise<BatchResult> {
        const client = await this.#connection();
        const call = { ...options, workLimits: options.workLimits ?? this.#limits.read };
        for (let attempt = 1; ; attempt++) {
            try {
                return await client.read(statements, call);
            } catch (error) {
                const delay = this.#retryDelay(error, attempt, options.signal);
                if (delay === undefined) throw error;
                await this.#sleep(delay, options.signal);
            }
        }
    }

    /**
     * One atomic batch. The exact request is saved before dispatch; an unknown outcome is
     * recovered with the same request ID and body, never with a replacement write.
     */
    async write(statements: Statement[], options: WriteCallOptions = {}): Promise<BatchResult> {
        const retries = options.retryConflicts ?? 0;
        for (let attempt = 0; ; attempt++) {
            try {
                return await this.#writeOnce(statements, attempt === 0 ? options : { ...options, requestId: undefined });
            } catch (error) {
                if (attempt >= retries || !(error instanceof ClientError) || error.outcome !== 'rolled-back' || error.code !== 'FDB_WRITE_CONFLICT') throw error;
                await this.#sleep(Math.floor(Math.random() * 10 * (attempt + 1)), options.signal).catch(() => {});
            }
        }
    }

    async #writeOnce(statements: Statement[], options: WriteCallOptions): Promise<BatchResult> {
        const client = await this.#connection();
        if (options.afterSequence === undefined && !client.sequenceKnown) await this.preflight(options);
        const request = client.prepareWrite(statements, { ...options, workLimits: options.workLimits ?? this.#limits.write });
        const id = preparedRequestId(request);
        await this.pending.put(id, { request, savedAt: this.#now(), ...(options.kind === undefined ? {} : { kind: options.kind }) });
        let lastError: unknown;
        for (let attempt = 1; ; attempt++) {
            try {
                const result = attempt === 1 ? await client.submit(request, options) : await client.recover(request, options);
                await this.pending.delete(id);
                return result;
            } catch (error) {
                lastError = error;
                if (!(error instanceof ClientError)) throw new UncertainWriteError(request, error);
                if (error.outcome === 'rolled-back' || (error.outcome === 'not-sent' && attempt === 1)) {
                    await this.pending.delete(id);
                    throw error;
                }
                if (options.signal?.aborted) break;
                const delay = this.#retryDelay(error, attempt, options.signal, true);
                if (delay === undefined) break;
                await this.#sleep(delay, options.signal).catch(() => {});
                if (options.signal?.aborted) break;
            }
        }
        throw new UncertainWriteError(request, lastError);
    }

    /** Recover one saved write by its request ID. */
    async recover(id: string, options: RequestOptions = {}): Promise<'confirmed' | 'rolled-back' | 'reconciled' | 'pending' | 'missing'> {
        const write = await this.pending.get(id);
        if (!write) return 'missing';
        const client = await this.#connection();
        try {
            await client.recover(write.request, options);
            await this.pending.delete(id);
            return 'confirmed';
        } catch (error) {
            if (error instanceof ClientError && error.outcome === 'rolled-back') {
                await this.pending.delete(id);
                return 'rolled-back';
            }
            if (!this.#outsideReceiptWindow(write, client.sequence)) return 'pending';
        }
        const reconcile = write.kind === undefined ? undefined : this.#options.reconcilers?.[write.kind];
        if (!reconcile) return 'pending';
        const decision = await reconcile(write, this);
        if (decision === 'committed' || decision === 'absent') {
            await this.pending.delete(id);
            return 'reconciled';
        }
        return 'pending';
    }

    /** Recover saved writes, oldest first. Run from a scheduled path. */
    async recoverPending(options: RequestOptions & { limit?: number } = {}): Promise<RecoveryReport> {
        const report: RecoveryReport = { confirmed: [], rolledBack: [], reconciled: [], pending: [] };
        for (const write of await this.pending.list({ limit: options.limit ?? 100 })) {
            const id = preparedRequestId(write.request);
            const status = await this.recover(id, options);
            if (status === 'confirmed') report.confirmed.push(id);
            else if (status === 'rolled-back') report.rolledBack.push(id);
            else if (status === 'reconciled') report.reconciled.push(id);
            else if (status === 'pending') report.pending.push(id);
        }
        return report;
    }

    /** Cloud only: start the database runtime. Request paths never warm; call this from a scheduled path. */
    async warm(options: RequestOptions = {}): Promise<WarmResult | undefined> {
        const client = await this.#connection();
        return client.cloud ? client.warm(options) : undefined;
    }

    async close(): Promise<void> {
        const client = this.#client;
        this.#client = undefined;
        this.#preflight = undefined;
        if (client) await (await client.catch(() => undefined))?.close();
    }

    #connection(): Promise<RemoteDatabase> {
        if (!this.#client) {
            const options: ConnectOptions = {
                url: this.#options.url,
                token: this.#options.token,
                ...(this.#options.timeoutMs === undefined ? {} : { timeoutMs: this.#options.timeoutMs }),
                ...(this.#options.fetch === undefined ? {} : { fetch: this.#options.fetch }),
            };
            const cloud = /\/databases\/[0-9a-f-]{36}\/?$/.test(options.url);
            // Request scopes never warm; Cloud URLs defer details until a write needs a sequence.
            this.#client = connectWithInfo(cloud ? { ...options, warm: false } : options).then(async ({ client, info }) => {
                if (info) {
                    // Local services return details at connect; check the engine right away.
                    try { checkEngine(info.engineVersion, this.#required); }
                    catch (error) { await client.close(); throw error; }
                    this.#preflight = Promise.resolve(info);
                }
                return client;
            });
            this.#client.catch(() => { this.#client = undefined; this.#preflight = undefined; });
        }
        return this.#client;
    }

    #retryDelay(error: unknown, attempt: number, signal: AbortSignal | undefined, writing = false): number | undefined {
        if (attempt >= this.#attempts || signal?.aborted || !(error instanceof ClientError)) return undefined;
        if (error.code === 'FDB_CANCELLED' || error.code === 'FDB_AUTH' || error.code === 'FDB_FORBIDDEN' || error.code === 'FDB_CLOSED') return undefined;
        const backpressure = error.status === 503 || error.status === 429;
        if (!backpressure && !(writing && error.outcome === 'unknown') && !(error.outcome === 'read-failed' && (error.code === 'FDB_TRANSPORT' || error.status === undefined))) return undefined;
        const base = error.retryAfterMs ?? 50 * 2 ** (attempt - 1);
        return Math.min(this.#maxDelay, base) + Math.floor(Math.random() * 25);
    }

    #outsideReceiptWindow(write: PendingWrite, current: number): boolean {
        const { afterSequence } = validatePrepared(write.request);
        return current - afterSequence >= 64;
    }
}

export function createRomeDB(options: RomeDBOptions): RomeDB {
    return new RomeDB(options);
}

/** Compare dotted numeric releases such as `0.2.9`. */
export function compareVersions(a: string, b: string): number {
    const pa = a.split('-')[0]!.split('.').map(Number);
    const pb = b.split('-')[0]!.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) return Math.sign(diff);
    }
    return 0;
}

function checkEngine(version: string | undefined, required: string): void {
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version) || compareVersions(version, required) < 0) throw new EngineVersionError(version, required);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
        const abort = () => { clearTimeout(timer); reject(signal!.reason); };
        signal?.addEventListener('abort', abort, { once: true });
    });
}
