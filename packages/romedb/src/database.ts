import {
    ClientError,
    connect,
    encodeValue,
    validatePrepared,
    type BatchResult,
    type Client,
    type DatabaseFile,
    type DatabaseInfo,
    type FileExportOptions,
    type PreparedWrite,
    type RemoteDatabase,
    type RequestOptions,
    type Statement as ClientStatement,
    type Value,
    type WarmResult,
    type WorkLimits,
} from '@romedb/client';
import { pendingCursor, preparedRequestId, type PendingCursor, type PendingWrite, type PendingWriteStore } from './pending';

/**
 * A file this process opened with `@romedb/node`, described here so that Workers, which never
 * open files, need neither that package nor its native addon.
 */
export interface EmbeddedClient extends Client {
    readonly url: string;
    readonly sequenceKnown: boolean;
    exportFile(options?: FileExportOptions): Promise<DatabaseFile>;
}

/** A service or Cloud connection, or a file this process opened with `@romedb/node`. */
export type DatabaseClient = RemoteDatabase | EmbeddedClient;

/** One RomeQL statement. `@romedb/node` calls the text `sql`; the binding passes it on as that. */
export interface Statement { rql: string; params?: { [key: string]: Value } }

/** The RomeDB engine release this package targets. Older engines are refused at preflight. */
export const REQUIRED_ENGINE_VERSION = '0.2.21';

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
    /** Service or Cloud credential. Not needed when `connect` opens the database. */
    token?: string;
    /**
     * Opens the database instead of the service client built from `url` and `token`, for
     * example `connectNode` from `@cossackframework/romedb/node` for files. Called again after a
     * failed open.
     */
    connect?: () => Promise<DatabaseClient>;
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
    /**
     * The signal of the request a call is made for, used when the call passes no `signal` of its
     * own. When it aborts, the request's calls end and give their places back. On Workers a call
     * whose request ends first never settles and keeps its place for good, so pass a signal that
     * aborts when the visitor leaves or the request fails, such as the CMS's (see the package
     * README, "Requests that end early").
     */
    requestSignal?: () => AbortSignal | undefined;
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
     * (`RDB_WRITE_CONFLICT`), up to this many times, as a new request. Use only when
     * re-evaluating the statements against newer data is correct. Default 0.
     */
    retryConflicts?: number;
}

export interface RecoveryReport {
    confirmed: string[];
    rolledBack: string[];
    reconciled: string[];
    pending: string[];
    /** Saved writes the store could not read (torn, or wrong permissions, owner or mode): kept for an operator. */
    unreadable: string[];
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

/** Statements one request carries, locally and on Cloud. */
export const MAX_STATEMENTS = 32;
/** Request JSON an engine that reports no limits accepts; Cloud accepts `CLOUD_REQUEST_BYTES`. `maxRequestBytes()` gives a database's own. */
export const LOCAL_REQUEST_BYTES = 65_536;
export const CLOUD_REQUEST_BYTES = 1_048_576;
/** Result JSON one request may return in all from an engine that reports no limits. `maxResultBytes()` gives a database's own. */
export const RESULT_BYTES = 262_144;
/** Rows one statement may return. */
export const MAX_ROWS = 1_000;

/** A request over the database's size or statement limit. Nothing was sent. */
export class RequestTooLargeError extends Error {
    readonly cause: unknown;
    constructor(cause: unknown) {
        super(`The database request is too large: ${(cause as Error)?.message ?? cause}`);
        this.name = 'RequestTooLargeError';
        this.cause = cause;
    }
}

/** About how many bytes these statements take in a request, as the client encodes them. */
export function statementBytes(statements: readonly Statement[]): number {
    const encoded = statements.map(statement => ({ sql: statement.rql, ...(statement.params ? { params: Object.fromEntries(Object.entries(statement.params).map(([key, value]) => [key, encodeValue(value)])) } : {}) }));
    return new TextEncoder().encode(JSON.stringify(encoded)).length;
}

/** The client's refusal of a request over the size or statement limit, before sending it. */
function tooLarge(error: unknown): error is RangeError {
    return error instanceof RangeError && /request exceeds|1\.\.32 statements/.test(error.message);
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

/** The client's own deadline for a call that names none (`@romedb/client`'s default `timeoutMs`). */
const CLIENT_TIMEOUT_MS = 20_000;
/** How long past its deadline a call may stay unsettled before it counts as stranded. */
const STRANDED_GRACE_MS = 5_000;

/**
 * The client refused a call for lack of places: it allows 32 calls (and 2 MiB of request
 * bodies) in flight. Nothing was sent.
 */
function refusedForPlaces(error: unknown): boolean {
    return error instanceof ClientError && error.code === 'RDB_LIMIT' && error.outcome === 'not-sent' && /request limit reached/i.test(error.message);
}

/** A call in flight on a client, by when it must have settled. */
interface InFlight { readonly deadline: number }

const DEFAULT_LIMITS: RomeDBWorkLimits = {
    read: { rowsRead: 50_000, vmSteps: 2_000_000 },
    write: { rowsRead: 50_000, rowMutations: 1_000, vmSteps: 2_000_000 },
};

/**
 * One database binding per isolate or process. Calls are request-scoped through their
 * options: pass the request's AbortSignal (or `requestSignal`) and explicit budgets.
 *
 * A client this binding opened from `url` is replaced when it refuses a call for lack of places
 * while some of its calls are long past their deadline: such calls were stranded (on Workers, a
 * call whose request ended first never settles), so their places would never come back. The old
 * client keeps the calls it still has. A refusal with no stranded call is backpressure: the call
 * waits and tries again, like a 503.
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
    #client: Promise<DatabaseClient> | undefined;
    /** The client `#client` resolved to. */
    #current: DatabaseClient | undefined;
    #preflight: Promise<DatabaseInfo> | undefined;
    /** Calls in flight through this binding, by client. */
    readonly #inFlight = new Map<DatabaseClient, Set<InFlight>>();
    /** Replaced clients, closed once their last call settles. */
    readonly #retired = new Set<DatabaseClient>();

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

    /**
     * The most request JSON this database accepts, as it reports it: 8 MiB on a local service
     * or a file since RomeDB 0.2.23, 1 MiB on Cloud. An engine that reports none takes 64 KiB.
     */
    async maxRequestBytes(): Promise<number> {
        return (await this.#connection()).limits.maxRequestBytes;
    }

    /** The most result JSON one request may return, all statements together, as the database reports it: 8 MiB since RomeDB 0.2.23, 256 KiB from an engine that reports none. */
    async maxResultBytes(): Promise<number> {
        return (await this.#connection()).limits.maxResultBytes;
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
        const scoped = this.#scoped(options);
        const call = { ...scoped, workLimits: scoped.workLimits ?? this.#limits.read };
        let replaced = false;
        for (let attempt = 1; ; attempt++) {
            const client = await this.#connection();
            try {
                return await this.#track(client, call, () => client.read(clientStatements(statements), call));
            } catch (error) {
                if (tooLarge(error)) throw new RequestTooLargeError(error);
                if (!replaced && refusedForPlaces(error) && this.#replaceStranded(client)) { replaced = true; attempt--; continue; }
                const delay = this.#retryDelay(error, attempt, call.signal);
                if (delay === undefined) throw error;
                await this.#wait(delay, call.signal);
            }
        }
    }

    /**
     * One atomic batch. The exact request is saved before dispatch; an unknown outcome is
     * recovered with the same request ID and body, never with a replacement write.
     */
    async write(statements: Statement[], options: WriteCallOptions = {}): Promise<BatchResult> {
        const call = this.#scoped(options);
        const retries = call.retryConflicts ?? 0;
        let conflicts = 0;
        let refusals = 0;
        let replaced = false;
        for (;;) {
            const client = await this.#connection();
            try {
                // A batch refused for lack of places was never sent: it keeps its request ID.
                return await this.#writeOnce(client, statements, conflicts === 0 ? call : { ...call, requestId: undefined });
            } catch (error) {
                if (refusedForPlaces(error)) {
                    if (!replaced && this.#replaceStranded(client)) { replaced = true; continue; }
                    const delay = this.#retryDelay(error, ++refusals, call.signal);
                    if (delay === undefined) throw error;
                    await this.#wait(delay, call.signal);
                    continue;
                }
                if (conflicts >= retries || !(error instanceof ClientError) || error.outcome !== 'rolled-back' || error.code !== 'RDB_WRITE_CONFLICT') throw error;
                conflicts++;
                await this.#sleep(Math.floor(Math.random() * 10 * conflicts), call.signal).catch(() => {});
            }
        }
    }

    async #writeOnce(client: DatabaseClient, statements: Statement[], options: WriteCallOptions): Promise<BatchResult> {
        if (options.afterSequence === undefined && !client.sequenceKnown) await this.preflight(options);
        let request: PreparedWrite;
        try {
            request = client.prepareWrite(clientStatements(statements), { ...options, workLimits: options.workLimits ?? this.#limits.write });
        } catch (error) {
            if (tooLarge(error)) throw new RequestTooLargeError(error);
            throw error;
        }
        const id = preparedRequestId(request);
        await this.pending.put(id, { request, savedAt: this.#now(), ...(options.kind === undefined ? {} : { kind: options.kind }) });
        let lastError: unknown;
        for (let attempt = 1; ; attempt++) {
            try {
                const result = await this.#track(client, options, () => attempt === 1 ? client.submit(request, options) : client.recover(request, options));
                await this.#forget(id);
                return result;
            } catch (error) {
                lastError = error;
                if (!(error instanceof ClientError)) throw new UncertainWriteError(request, error);
                if (error.outcome === 'rolled-back' || (error.outcome === 'not-sent' && attempt === 1)) {
                    await this.#forget(id);
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

    /**
     * Drop a saved write whose outcome is known. A failed delete never changes that outcome: the
     * write stays saved and a later `recoverPending` confirms or rolls it back again.
     */
    async #forget(id: string): Promise<void> {
        await this.pending.delete(id).catch(() => {});
    }

    /** Recover one saved write by its request ID. */
    async recover(id: string, options: RequestOptions = {}): Promise<'confirmed' | 'rolled-back' | 'reconciled' | 'pending' | 'missing'> {
        const write = await this.pending.get(id);
        if (!write) return 'missing';
        const client = await this.#connection();
        if (client.databaseId === undefined) await this.preflight(options);
        if (write.request.url !== client.url) return 'pending';
        // An embedded file gets a new identity each time it opens, and a restored database a new
        // one too: no receipt can confirm a write from an earlier identity, so reconcile it.
        if (write.request.databaseId === client.databaseId) {
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

    /**
     * Recover saved writes, oldest first. Run from a scheduled path. `limit` bounds the recovery
     * attempts; writes nothing here can resolve (another URL, or an earlier database identity
     * with no reconciler for their kind) are passed over without counting, so they cannot hold
     * back newer writes, and stay saved for an operator. At most `limit * 20` writes are read.
     */
    async recoverPending(options: RequestOptions & { limit?: number } = {}): Promise<RecoveryReport> {
        const report: RecoveryReport = { confirmed: [], rolledBack: [], reconciled: [], pending: [], unreadable: [] };
        const limit = Math.max(1, options.limit ?? 100);
        let attempts = 0;
        let scanned = 0;
        let after: PendingCursor | undefined;
        // Each list reports what it could not read; a write set aside on one page is gone from the next.
        const unreadable = new Set<string>();
        while (attempts < limit && scanned < limit * 20) {
            const page = await this.pending.list({ limit, ...(after ? { after } : {}) });
            for (const id of this.pending.unreadable?.() ?? []) unreadable.add(id);
            if (!page.length) break;
            for (const write of page) {
                scanned++;
                after = pendingCursor(write);
                const id = after.id;
                if (await this.#unresolvable(write, options)) {
                    report.pending.push(id);
                    continue;
                }
                if (attempts >= limit) break;
                attempts++;
                const status = await this.recover(id, options).catch(() => 'pending' as const);
                if (status === 'confirmed') report.confirmed.push(id);
                else if (status === 'rolled-back') report.rolledBack.push(id);
                else if (status === 'reconciled') report.reconciled.push(id);
                else if (status === 'pending') report.pending.push(id);
            }
            if (page.length < limit) break;
        }
        report.unreadable.push(...unreadable);
        return report;
    }

    /** Whether `recover` could only answer `pending` for this write, without asking the database. */
    async #unresolvable(write: PendingWrite, options: RequestOptions): Promise<boolean> {
        const client = await this.#connection();
        if (client.databaseId === undefined) await this.preflight(options);
        if (write.request.url !== client.url) return true;
        if (write.request.databaseId === client.databaseId) return false;
        return write.kind === undefined || !this.#options.reconcilers?.[write.kind];
    }

    /**
     * The database as a `.romedb` file: one snapshot, while reads and writes continue, on every
     * form of RomeDB. It is the whole database, sessions and credentials included, unless
     * `emptyTables` names tables to leave out: their rows reach no part of the file, and the file
     * is then a new database. Read `body` to the end or cancel it.
     */
    async exportFile(options: FileExportOptions = {}): Promise<DatabaseFile> {
        // Older engines cannot leave tables out, and Cloud connections have not checked yet.
        await this.preflight(options.signal ? { signal: options.signal } : {});
        return (await this.#connection()).exportFile(options);
    }

    /** Cloud only: start the database runtime. Request paths never warm; call this from a scheduled path. */
    async warm(options: RequestOptions = {}): Promise<WarmResult | undefined> {
        const client = await this.#connection();
        return cloud(client) ? client.warm(options) : undefined;
    }

    async close(): Promise<void> {
        const client = this.#client;
        this.#client = undefined;
        this.#current = undefined;
        this.#preflight = undefined;
        const retired = [...this.#retired];
        this.#retired.clear();
        await Promise.all(retired.map(old => old.close().catch(() => {})));
        if (client) await (await client.catch(() => undefined))?.close();
    }

    /** Wait before a call tries again; a signal that aborts meanwhile ends the call, unsent. */
    async #wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
        try { await this.#sleep(ms, signal); }
        catch (cause) {
            if (signal?.aborted) throw new ClientError('RDB_CANCELLED', 'Request cancelled before dispatch', 'not-sent', { cause });
            throw cause;
        }
    }

    /** The call's own signal, or else the request's. */
    #scoped<T extends RequestOptions>(options: T): T {
        if (options.signal !== undefined) return options;
        const signal = this.#options.requestSignal?.();
        return signal ? { ...options, signal } : options;
    }

    /** Run a call on a client, keeping it among the calls in flight until it settles. */
    async #track<T>(client: DatabaseClient, options: RequestOptions, run: () => Promise<T>): Promise<T> {
        const call: InFlight = { deadline: this.#now() + (options.timeoutMs ?? this.#options.timeoutMs ?? CLIENT_TIMEOUT_MS) + STRANDED_GRACE_MS };
        let calls = this.#inFlight.get(client);
        if (!calls) this.#inFlight.set(client, calls = new Set());
        calls.add(call);
        try {
            return await run();
        } finally {
            calls.delete(call);
            if (!calls.size) {
                this.#inFlight.delete(client);
                if (this.#retired.delete(client)) void client.close().catch(() => {});
            }
        }
    }

    /**
     * After the client refused a call for lack of places: when calls past their deadline hold
     * places on it, they were stranded and never give them back, so the next call opens a new
     * client. True when the call should try again on another client (also when another call
     * replaced it already). Clients from `connect`, such as files, are never replaced.
     */
    #replaceStranded(client: DatabaseClient): boolean {
        if (this.#options.connect) return false;
        if (this.#current !== client) return this.#current !== undefined || this.#client !== undefined;
        const now = this.#now();
        const stranded = [...this.#inFlight.get(client) ?? []].filter(call => call.deadline <= now).length;
        if (!stranded) return false;
        this.#client = undefined;
        this.#current = undefined;
        this.#preflight = undefined;
        if (this.#inFlight.has(client)) this.#retired.add(client);
        console.warn(`[romedb] ${stranded} database call(s) never settled after their deadline and hold the client's places: a new client takes over.`);
        return true;
    }

    #connection(): Promise<DatabaseClient> {
        if (!this.#client) {
            const { url, token, timeoutMs, fetch } = this.#options;
            // Request scopes never warm; Cloud URLs defer details until a write needs a sequence.
            const open = this.#options.connect ?? (() => connect({
                url, token: token ?? '', warm: false,
                ...(timeoutMs === undefined ? {} : { timeoutMs }),
                ...(fetch === undefined ? {} : { fetch }),
            }));
            const opening: Promise<DatabaseClient> = open().then(async client => {
                if (!cloud(client)) {
                    // Files and local services answer details at once; check the engine right away.
                    try {
                        const info = await client.info();
                        checkEngine(info.engineVersion, this.#required);
                        if (this.#client === opening) this.#preflight = Promise.resolve(info);
                    } catch (error) { await client.close(); throw error; }
                }
                if (this.#client === opening) this.#current = client;
                return client;
            });
            this.#client = opening;
            opening.catch(() => { if (this.#client === opening) { this.#client = undefined; this.#preflight = undefined; } });
        }
        return this.#client;
    }

    #retryDelay(error: unknown, attempt: number, signal: AbortSignal | undefined, writing = false): number | undefined {
        if (attempt >= this.#attempts || signal?.aborted || !(error instanceof ClientError)) return undefined;
        if (error.code === 'RDB_CANCELLED' || error.code === 'RDB_AUTH' || error.code === 'RDB_FORBIDDEN' || error.code === 'RDB_CLOSED') return undefined;
        // The client's own places are full: wait for calls of other requests to settle.
        if (refusedForPlaces(error)) return Math.min(this.#maxDelay, 25 * 2 ** attempt) + Math.floor(Math.random() * 50);
        const backpressure = error.status === 503 || error.status === 429;
        if (!backpressure && !(writing && error.outcome === 'unknown') && !(error.outcome === 'read-failed' && (error.code === 'RDB_TRANSPORT' || error.status === undefined))) return undefined;
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

function clientStatements(statements: Statement[]): ClientStatement[] {
    if (!Array.isArray(statements)) throw new TypeError('statements require an array');
    return statements.map(statement => {
        if (statement === null || typeof statement !== 'object' || typeof statement.rql !== 'string' || Object.keys(statement).some(key => key !== 'rql' && key !== 'params')) {
            throw new TypeError('statement requires RomeQL text in `rql` and optional params');
        }
        return statement.params === undefined ? { sql: statement.rql } : { sql: statement.rql, params: statement.params };
    });
}

function cloud(client: DatabaseClient): client is RemoteDatabase {
    return 'cloud' in client && client.cloud;
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
