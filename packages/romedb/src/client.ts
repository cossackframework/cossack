/**
 * RomeDB service-protocol client on Web APIs (fetch, crypto.randomUUID, AbortSignal).
 * Runs on Cloudflare Workers, Node.js, Deno and browsers' server runtimes alike.
 * Behavior follows the RomeDB service contract and `@romedb/node/client` 0.2.9.
 */
import { decodeValue, encodeValue, plainObject, text, type Value } from './values';

const MAX_REQUEST = 65_536;
const MAX_CLOUD_REQUEST = 1_048_576;
const CLOUD_QUERY_VERSION = 3;
const MAX_RESPONSE = 524_288;
const MAX_RESULT = 262_144;
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER - 1;
const WARM_STATES = new Set(['ready', 'starting', 'skipped']);
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const encoder = new TextEncoder();

export interface Statement { rql: string; params?: { [key: string]: Value } }
export interface RequestOptions { signal?: AbortSignal; timeoutMs?: number }
export interface WorkLimits { rowsRead?: number; rowMutations?: number; vmSteps?: number }
export interface ReadOptions extends RequestOptions { afterSequence?: number; workLimits?: WorkLimits }
export interface WriteOptions extends ReadOptions { requestId?: string; ifSequence?: number }
/** A saved write: exact URL, database identity and body. Never contains a credential. */
export interface PreparedWrite {
    readonly version: 2;
    readonly url: string;
    readonly databaseId: string;
    readonly queryVersion: 2 | 3;
    readonly body: string;
}
export interface QueryResult { columns: string[]; rows: Value[][]; affected: bigint }
export interface ExecutionWork { rowsRead?: number; rowMutations?: number; vmSteps?: number; catalogRowsRead?: number; [key: string]: unknown }
export interface BatchResult { requestId: string; sequence: number; results: QueryResult[]; readVersion?: 2; executionWork?: ExecutionWork }
export interface Capabilities { provenance: 'negotiated' | 'documented'; [key: string]: unknown }
export interface DatabaseInfo {
    id: string;
    sequence: number;
    capabilities: Capabilities;
    /** RomeDB release of the engine, such as "0.2.9". */
    engineVersion?: string;
    [key: string]: unknown;
}
export interface ConnectOptions {
    url: string;
    token: string;
    timeoutMs?: number;
    fetch?: typeof globalThis.fetch;
    /** Cloud URLs skip the details request at connect by default. */
    deferInfo?: boolean;
    /** Cloud URLs send a background warm request at connect by default. */
    warm?: boolean;
}
export interface WarmResult { state: 'ready' | 'starting' | 'skipped' }
export type Outcome = 'not-sent' | 'read-failed' | 'unknown' | 'rolled-back';

export class ClientError extends Error {
    readonly code: string;
    readonly outcome: Outcome;
    readonly request?: PreparedWrite;
    readonly status?: number;
    readonly sequence?: number;
    /** Server backpressure hint from `retry-after`, in milliseconds. */
    readonly retryAfterMs?: number;
    /** For `FDB_TRANSPORT` and `FDB_PROTOCOL`: the fetch or parse error underneath (`ECONNREFUSED`, `ECONNRESET`, ...). */
    declare readonly cause?: unknown;
    constructor(code: string, message: string, outcome: Outcome, details: { request?: PreparedWrite; status?: number; sequence?: number; retryAfterMs?: number; cause?: unknown } = {}) {
        super(message, details.cause === undefined ? undefined : { cause: details.cause });
        this.name = 'ClientError';
        this.code = code;
        this.outcome = outcome;
        if (details.request !== undefined) this.request = details.request;
        if (details.status !== undefined) this.status = details.status;
        if (details.sequence !== undefined) this.sequence = details.sequence;
        if (details.retryAfterMs !== undefined) this.retryAfterMs = details.retryAfterMs;
    }
}

export interface Client {
    readonly sequence: number;
    readonly databaseId: string | undefined;
    readonly url: string;
    readonly cloud: boolean;
    info(options?: RequestOptions): Promise<DatabaseInfo>;
    warm(options?: RequestOptions): Promise<WarmResult>;
    read(statements: Statement[], options?: ReadOptions): Promise<BatchResult>;
    prepareWrite(statements: Statement[], options?: WriteOptions): PreparedWrite;
    submit(request: PreparedWrite, options?: RequestOptions): Promise<BatchResult>;
    recover(request: PreparedWrite, options?: RequestOptions): Promise<BatchResult>;
    writeAtomic(statements: Statement[], options?: WriteOptions): Promise<BatchResult>;
    close(): Promise<void>;
}

const construction = Symbol('RemoteDatabase');

export async function connect(options: ConnectOptions): Promise<RemoteDatabase> {
    return (await connectWithInfo(options)).client;
}

/** Connect and return the details read at connect, if the connection did not defer them. */
export async function connectWithInfo(options: ConnectOptions): Promise<{ client: RemoteDatabase; info: DatabaseInfo | undefined }> {
    const db = new RemoteDatabase(options, construction);
    if (db.warmsAtConnect) db.warm().catch(() => {});
    if (db.deferred) return { client: db, info: undefined };
    try { return { client: db, info: await db.info() }; }
    catch (error) { await db.close(); throw error; }
}

interface ReplyEnvelope { [key: string]: unknown }

export class RemoteDatabase implements Client {
    #url: string;
    #token: string;
    #fetch: typeof globalThis.fetch;
    #timeout: number;
    #sequence = 0;
    #id: string | undefined;
    #capabilities: Capabilities;
    #closed = false;
    #active = new Set<AbortController>();
    #inflightBytes = 0;
    #sequenceKnown = false;
    #deferred = false;
    #cloud: boolean;
    #warm: boolean;

    constructor(options: ConnectOptions, key: symbol) {
        if (key !== construction) throw new TypeError('use connect()');
        if (!plainObject(options)) throw new TypeError('connection options require an object');
        this.#url = normalizeUrl(options.url);
        if (typeof options.token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(options.token)) throw new TypeError('token requires a bounded bearer credential');
        this.#token = options.token;
        const fetcher = options.fetch ?? globalThis.fetch;
        if (typeof fetcher !== 'function') throw new TypeError('fetch must be a function');
        // Workers reject fetch called with a foreign `this`.
        this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
        this.#timeout = timeout(options.timeoutMs ?? 20_000);
        if (options.deferInfo !== undefined && typeof options.deferInfo !== 'boolean') throw new TypeError('deferInfo requires a boolean');
        if (options.warm !== undefined && typeof options.warm !== 'boolean') throw new TypeError('warm requires a boolean');
        const cloudId = /\/databases\/([0-9a-f-]{36})$/.exec(this.#url)?.[1];
        this.#cloud = cloudId !== undefined;
        if (!this.#cloud && options.deferInfo === true) throw new TypeError('deferInfo applies only to Cloud database URLs');
        if (!this.#cloud && options.warm === true) throw new TypeError('warm applies only to Cloud database URLs');
        this.#capabilities = { provenance: 'documented' };
        // Cloud database URLs carry the database id and have documented capabilities,
        // so the details request waits until a write needs a current sequence.
        if (this.#cloud && options.deferInfo !== false) {
            this.#id = cloudId;
            this.#capabilities = capabilities(this.#url, {});
            this.#deferred = true;
        }
        this.#warm = this.#cloud && options.warm !== false;
    }

    get warmsAtConnect(): boolean { return this.#warm; }
    get deferred(): boolean { return this.#deferred; }
    get url(): string { return this.#url; }
    get cloud(): boolean { return this.#cloud; }
    get sequence(): number { return this.#sequence; }
    get databaseId(): string | undefined { return this.#id; }
    /** True once a reply has established the current publication sequence. */
    get sequenceKnown(): boolean { return this.#sequenceKnown; }

    async info(options: RequestOptions = {}): Promise<DatabaseInfo> {
        const info = await this.#request('', undefined, options, false) as ReplyEnvelope;
        if (!plainObject(info) || typeof info.id !== 'string' || !ID.test(info.id) || !sequence(info.sequence, true) || (this.#id !== undefined && this.#id !== info.id)) {
            throw new ClientError('FDB_PROTOCOL', 'Invalid database details or changed database identity', 'read-failed');
        }
        const supported = capabilities(this.#url, info);
        this.#id = info.id;
        this.#sequence = Math.max(this.#sequence, info.sequence as number);
        this.#sequenceKnown = true;
        this.#capabilities = supported;
        return { ...info, id: info.id, sequence: info.sequence as number, capabilities: supported } as DatabaseInfo;
    }

    async warm(options: RequestOptions = {}): Promise<WarmResult> {
        this.#assertOpen();
        if (!this.#cloud) throw new ClientError('FDB_UNSUPPORTED', 'warm applies only to Cloud database URLs', 'not-sent');
        const reply = await this.#request('/warm', '{}', options, false) as ReplyEnvelope;
        if (!plainObject(reply) || !WARM_STATES.has(reply.state as string)) throw new ClientError('FDB_PROTOCOL', 'Invalid warm reply', 'read-failed');
        return { state: reply.state as WarmResult['state'] };
    }

    async read(statements: Statement[], options: ReadOptions = {}): Promise<BatchResult> {
        this.#assertOpen();
        if (this.#capabilities.readVersion !== 2) throw new ClientError('FDB_UNSUPPORTED', 'Database does not support fresh reads', 'not-sent');
        if ((options as WriteOptions).ifSequence !== undefined) throw new TypeError('fresh reads do not accept ifSequence');
        const afterSequence = options.afterSequence ?? this.#sequence;
        checkSequence(afterSequence);
        const workLimits = encodeWorkLimits(options.workLimits);
        const queryVersion = this.#queryVersion();
        const body = JSON.stringify({ readVersion: 2, requestId: crypto.randomUUID(), afterSequence, statements: encodeStatements(statements, queryVersion), ...(workLimits === undefined ? {} : { workLimits }) });
        checkBodySize(body, queryVersion);
        const request = JSON.parse(body) as SavedBody;
        const reply = await this.#request('/read', body, options, false, undefined, queryVersion);
        const result = confirmReply(reply, request, true);
        this.#sequence = Math.max(this.#sequence, result.sequence);
        this.#sequenceKnown = true;
        return result;
    }

    prepareWrite(statements: Statement[], options: WriteOptions = {}): PreparedWrite {
        this.#assertOpen();
        if (!this.#sequenceKnown && this.#deferred && options.afterSequence === undefined) {
            throw new ClientError('FDB_SEQUENCE_UNKNOWN', 'Read, call info() or pass afterSequence before preparing a write on a deferred connection', 'not-sent');
        }
        if (this.#capabilities.atomicWrites !== true || this.#capabilities.replayWindow !== 64) throw new ClientError('FDB_UNSUPPORTED', 'Database does not support atomic writes with recovery', 'not-sent');
        const afterSequence = options.afterSequence ?? this.#sequence;
        checkSequence(afterSequence);
        if (options.ifSequence !== undefined) {
            if (this.#capabilities.exactSequenceCondition !== true) throw new ClientError('FDB_UNSUPPORTED', 'Database does not support exact sequence conditions', 'not-sent');
            checkSequence(options.ifSequence);
            if (options.ifSequence < afterSequence) throw new RangeError('ifSequence must be at least afterSequence');
        }
        const requestId = options.requestId ?? crypto.randomUUID();
        if (typeof requestId !== 'string' || !ID.test(requestId)) throw new TypeError('requestId requires 1..80 letters, digits, underscores or hyphens');
        const workLimits = encodeWorkLimits(options.workLimits);
        const queryVersion = this.#queryVersion();
        const body = JSON.stringify({ requestId, afterSequence, ...(options.ifSequence === undefined ? {} : { ifSequence: options.ifSequence }), statements: encodeStatements(statements, queryVersion), ...(workLimits === undefined ? {} : { workLimits }) });
        checkBodySize(body, queryVersion);
        return Object.freeze({ version: 2, url: this.#url, databaseId: this.#id!, queryVersion, body });
    }

    async submit(prepared: PreparedWrite, options: RequestOptions = {}): Promise<BatchResult> {
        this.#assertOpen();
        const request = validatePrepared(prepared);
        if (this.#capabilities.atomicWrites !== true || this.#capabilities.replayWindow !== 64 || (request.ifSequence !== undefined && this.#capabilities.exactSequenceCondition !== true)) {
            throw new ClientError('FDB_UNSUPPORTED', 'Database does not support this write contract', 'not-sent', { request: prepared });
        }
        if (prepared.url !== this.#url || prepared.databaseId !== this.#id) throw new ClientError('FDB_REQUEST_IDENTITY', 'Saved request belongs to another database', 'not-sent');
        try {
            const reply = await this.#request('/query', prepared.body, options, true, prepared, prepared.queryVersion);
            const result = confirmReply(reply, request, false, prepared);
            this.#sequence = Math.max(this.#sequence, result.sequence);
            this.#sequenceKnown = true;
            return result;
        } catch (error) {
            if (error instanceof ClientError) {
                if (error.outcome === 'rolled-back' && error.sequence !== undefined) this.#sequence = Math.max(this.#sequence, error.sequence);
                throw error;
            }
            throw new ClientError('FDB_PROTOCOL', 'Write response could not be confirmed; recover the saved request', 'unknown', { request: prepared });
        }
    }

    async recover(prepared: PreparedWrite, options: RequestOptions = {}): Promise<BatchResult> {
        try { return await this.submit(prepared, options); }
        catch (error) {
            if (error instanceof ClientError && error.outcome === 'not-sent') {
                throw new ClientError(error.code, 'Recovery did not confirm the earlier write; keep the saved request', 'unknown', { request: prepared });
            }
            throw error;
        }
    }

    async writeAtomic(statements: Statement[], options: WriteOptions = {}): Promise<BatchResult> {
        if (!this.#sequenceKnown && this.#deferred && options.afterSequence === undefined) await this.info(options);
        return this.submit(this.prepareWrite(statements, options), options);
    }

    async close(): Promise<void> {
        this.#closed = true;
        for (const controller of this.#active) controller.abort();
        this.#token = '';
    }

    #assertOpen(): void {
        if (this.#closed) throw new ClientError('FDB_CLOSED', 'Database client is closed', 'not-sent');
    }

    #queryVersion(): 2 | 3 { return this.#cloud ? CLOUD_QUERY_VERSION : 2; }

    async #request(path: string, body: string | undefined, options: RequestOptions, writing: boolean, prepared?: PreparedWrite, queryVersion: 2 | 3 = 2): Promise<unknown> {
        this.#assertOpen();
        const duration = timeout(options.timeoutMs ?? this.#timeout);
        if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new TypeError('signal must be an AbortSignal');
        const details = prepared ? { request: prepared } : {};
        if (options.signal?.aborted) throw new ClientError('FDB_CANCELLED', 'Request cancelled before dispatch', 'not-sent', details);
        const bodyBytes = body === undefined ? 0 : encoder.encode(body).byteLength;
        if (this.#active.size >= 32 || this.#inflightBytes + bodyBytes > 2_097_152) throw new ClientError('FDB_LIMIT', 'Client request limit reached', 'not-sent', details);
        const controller = new AbortController();
        const abort = () => controller.abort();
        options.signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, duration);
        this.#active.add(controller);
        this.#inflightBytes += bodyBytes;
        const credential = this.#token;
        let status: number | undefined;
        let retryAfterMs: number | undefined;
        try {
            const queryPath = path === '/query' || path === '/read';
            const headers: { [key: string]: string } = { authorization: `Bearer ${credential}`, accept: 'application/json' };
            if (body !== undefined) headers['content-type'] = 'application/json';
            if (this.#id !== undefined) headers['x-romedb-database-id'] = prepared?.databaseId ?? this.#id;
            if (queryVersion === CLOUD_QUERY_VERSION && queryPath) headers['x-romedb-query-version'] = String(queryVersion);
            const response = await this.#fetch(this.#url + path, {
                method: body === undefined ? 'GET' : 'POST',
                headers,
                ...(body === undefined ? {} : { body }),
                // Workers do not implement redirect: 'error'. Never follow a redirect with the credential.
                redirect: 'manual',
                signal: controller.signal,
            });
            status = response.status;
            if (response.type === 'opaqueredirect' || (status >= 300 && status < 400)) {
                await response.body?.cancel().catch(() => {});
                throw new ClientError('FDB_PROTOCOL', 'Database URL redirected; redirects are never followed with a credential', writing ? 'unknown' : 'read-failed', { status, ...details });
            }
            retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
            const replyVersion = response.headers.get('x-romedb-query-version');
            if (queryPath && replyVersion !== null && replyVersion !== '2' && replyVersion !== String(queryVersion)) {
                await response.body?.cancel();
                throw new ClientError('FDB_PROTOCOL', 'Unsupported database query response version', writing ? 'unknown' : 'read-failed', { status, ...details });
            }
            const reply = await boundedJson(response, MAX_RESPONSE) as ReplyEnvelope | null;
            const replyError = reply?.error;
            if (plainObject(replyError) && typeof replyError.message === 'string') replyError.message = redactMessage(replyError.message, credential);
            if (!response.ok && !(writing && reply?.requestId && reply?.sequence !== undefined)) {
                const code = plainObject(replyError) && typeof replyError.code === 'string' && /^FDB_[A-Z0-9_]{1,80}$/.test(replyError.code) ? replyError.code : httpCode(status);
                throw new ClientError(code, safeMessage(reply, credential), writing ? 'unknown' : 'read-failed', { status, ...details, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) });
            }
            return reply;
        } catch (error) {
            if (error instanceof ClientError) {
                const outcome: Outcome = writing ? 'unknown' : error.outcome === 'not-sent' ? 'not-sent' : 'read-failed';
                throw new ClientError(error.code, redactMessage(error.message, credential), outcome, {
                    ...(error.status === undefined ? {} : { status: error.status }),
                    ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
                    ...details,
                });
            }
            const code = controller.signal.aborted ? 'FDB_CANCELLED' : status === undefined ? 'FDB_TRANSPORT' : 'FDB_PROTOCOL';
            throw new ClientError(code, writing ? 'Write was not confirmed; recover the saved request' : 'Database request failed', writing ? 'unknown' : 'read-failed', {
                ...(status === undefined ? {} : { status }),
                ...details,
                cause: error,
            });
        } finally {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', abort);
            this.#active.delete(controller);
            this.#inflightBytes -= bodyBytes;
        }
    }
}

/** Normalize a local service, Cloud or `romedb://` URL to the canonical database URL. */
export function normalizeUrl(input: string): string {
    if (typeof input !== 'string' || input.length > 4096) throw new TypeError('url requires a bounded database URL');
    // romedb:// is an alias for https://; the same checks apply after the rewrite.
    const url = new URL(input.startsWith('romedb://') ? 'https://' + input.slice('romedb://'.length) : input);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
        throw new TypeError('use HTTPS or loopback HTTP without URL credentials, query or fragment');
    }
    let path = url.pathname.replace(/\/$/, '').replace(/\/(?:query|read)$/, '');
    if (loopback && !path) path = '/v1/database';
    if (!(loopback && path === '/v1/database') && !new RegExp(`^/v1/organizations/${UUID}/databases/${UUID}$`).test(path)) {
        throw new TypeError('use a local service URL or stable organization-scoped Cloud database URL');
    }
    return url.origin + path;
}

interface SavedBody { requestId: string; afterSequence: number; ifSequence?: number; statements: unknown[]; workLimits?: WorkLimits; readVersion?: 2 }

/** Validate a saved write before replaying it. Throws on any envelope change. */
export function validatePrepared(prepared: unknown): SavedBody {
    if (!plainObject(prepared) || Object.keys(prepared).sort().join(',') !== 'body,databaseId,queryVersion,url,version' || prepared.version !== 2 ||
        (prepared.queryVersion !== 2 && prepared.queryVersion !== CLOUD_QUERY_VERSION) || typeof prepared.databaseId !== 'string' || !prepared.databaseId ||
        typeof prepared.url !== 'string' || normalizeUrl(prepared.url) !== prepared.url || typeof prepared.body !== 'string') {
        throw new TypeError('invalid saved request');
    }
    checkBodySize(prepared.body, prepared.queryVersion);
    const body = JSON.parse(prepared.body) as unknown;
    if (!plainObject(body) || Object.keys(body).some(key => !['requestId', 'afterSequence', 'ifSequence', 'statements', 'workLimits'].includes(key)) || typeof body.requestId !== 'string' || !ID.test(body.requestId)) {
        throw new TypeError('invalid saved request identity');
    }
    encodeWorkLimits(body.workLimits as WorkLimits | undefined);
    checkSequence(body.afterSequence as number);
    if (body.ifSequence !== undefined) {
        checkSequence(body.ifSequence as number);
        if ((body.ifSequence as number) < (body.afterSequence as number)) throw new RangeError('invalid saved sequence condition');
    }
    if (!Array.isArray(body.statements) || body.statements.length < 1 || body.statements.length > 32) throw new TypeError('invalid saved statements');
    // Saved bodies are wire JSON: each statement carries the protocol's `sql` field.
    for (const statement of body.statements) {
        if (!plainObject(statement) || Object.keys(statement).some(key => key !== 'sql' && key !== 'params') || typeof statement.sql !== 'string' || !statement.sql.trim() || (statement.params !== undefined && !plainObject(statement.params))) {
            throw new TypeError('invalid saved statement');
        }
        for (const value of Object.values((statement.params ?? {}) as object)) decodeValue(value);
    }
    return body as unknown as SavedBody;
}

/** The request ID of a saved write. */
export function preparedRequestId(prepared: PreparedWrite): string {
    return validatePrepared(prepared).requestId;
}

function encodeStatements(statements: Statement[], queryVersion: 2 | 3): unknown[] {
    if (!Array.isArray(statements) || statements.length < 1 || statements.length > 32) throw new RangeError('request requires 1..32 statements');
    return statements.map(statement => {
        if (!plainObject(statement) || Object.keys(statement).some(key => key !== 'rql' && key !== 'params') || typeof statement.rql !== 'string' || !statement.rql.trim()) {
            throw new TypeError('statement requires SQL and optional params');
        }
        if (statement.params === undefined) return { sql: text(statement.rql) };
        if (!plainObject(statement.params)) throw new TypeError('params require an object');
        const params: { [key: string]: unknown } = {};
        for (const [key, value] of Object.entries(statement.params)) {
            if (value === undefined) throw new TypeError(`parameter ${key} is undefined`);
            params[text(key)] = encodeValue(value, queryVersion === CLOUD_QUERY_VERSION);
        }
        return { sql: text(statement.rql), params };
    });
}

function confirmReply(reply: unknown, request: SavedBody, reading: boolean, prepared?: PreparedWrite): BatchResult {
    const details = prepared ? { request: prepared } : {};
    const invalid = () => new ClientError('FDB_PROTOCOL', reading ? 'Read response identity or results differ' : 'Write response could not be confirmed; recover the saved request', reading ? 'read-failed' : 'unknown', details);
    if (!plainObject(reply) || reply.requestId !== request.requestId || !sequence(reply.sequence, true)) throw invalid();
    const replySequence = reply.sequence as number;
    if (reading ? reply.readVersion !== 2 || replySequence < request.afterSequence : reply.readVersion !== undefined || replySequence <= request.afterSequence || replySequence - request.afterSequence > 64) throw invalid();
    const error = reply.error;
    if (plainObject(error) && typeof error.code === 'string' && /^FDB_[A-Z0-9_]+$/.test(error.code) && typeof error.message === 'string' && reply.results === undefined) {
        throw new ClientError(error.code, error.message.slice(0, 2048), reading ? 'read-failed' : 'rolled-back', { sequence: replySequence, ...details });
    }
    if (!Array.isArray(reply.results) || reply.results.length !== request.statements.length || reply.error !== undefined || encoder.encode(JSON.stringify(reply.results)).byteLength > MAX_RESULT) throw invalid();
    try {
        const results = reply.results.map((result: unknown): QueryResult => {
            if (!plainObject(result) || !Array.isArray(result.columns) || result.columns.some(name => typeof name !== 'string') || !Array.isArray(result.rows) || result.rows.length > 1000 ||
                typeof result.affected !== 'string' || !/^(?:0|[1-9][0-9]{0,19})$/.test(result.affected) || BigInt(result.affected) > (1n << 64n) - 1n) throw invalid();
            const width = result.columns.length;
            return {
                columns: result.columns as string[],
                rows: result.rows.map((row: unknown) => {
                    if (!Array.isArray(row) || row.length !== width) throw invalid();
                    return row.map(value => decodeValue(value));
                }),
                affected: BigInt(result.affected),
            };
        });
        return {
            requestId: reply.requestId as string,
            sequence: replySequence,
            results,
            ...(reading ? { readVersion: 2 as const } : {}),
            ...(reply.executionWork === undefined ? {} : { executionWork: reply.executionWork as ExecutionWork }),
        };
    } catch { throw invalid(); }
}

async function boundedJson(response: Response, limit: number): Promise<unknown> {
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel().catch(() => {});
        throw new TypeError('response requires JSON');
    }
    if (!response.body) throw new TypeError('response body is missing');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > limit) throw new RangeError('response exceeds client byte limit');
            chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } finally { await reader.cancel().catch(() => {}); }
}

function capabilities(url: string, info: ReplyEnvelope): Capabilities {
    if (url.endsWith('/v1/database')) {
        const caps = info.capabilities;
        if (info.serviceVersion !== 1 || !plainObject(caps) || !plainObject(info.limits) || caps.readVersion !== 2 || typeof caps.atomicWrites !== 'boolean' ||
            typeof caps.exactSequenceCondition !== 'boolean' || (caps.atomicWrites && caps.replayWindow !== 64)) {
            throw new ClientError('FDB_PROTOCOL', 'Unsupported database client contract', 'read-failed');
        }
        return { ...caps, provenance: 'negotiated' };
    }
    return { provenance: 'documented', readVersion: 2, atomicWrites: true, replayWindow: 64, exactSequenceCondition: true, negotiatedLimits: false };
}

function sequence(value: unknown, reply = false): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= (reply ? MAX_SEQUENCE + 1 : MAX_SEQUENCE);
}

function encodeWorkLimits(value: WorkLimits | undefined): WorkLimits | undefined {
    if (value === undefined) return undefined;
    const ceilings = { rowsRead: 1_000_000, rowMutations: 100_000, vmSteps: 10_000_000 } as const;
    if (!plainObject(value)) throw new TypeError('workLimits require an object');
    for (const [name, limit] of Object.entries(value)) {
        if (!Object.hasOwn(ceilings, name) || !Number.isSafeInteger(limit) || (limit as number) < 0 || (limit as number) > ceilings[name as keyof typeof ceilings]) {
            throw new RangeError('workLimits require nonnegative integers within the service ceilings');
        }
    }
    const result: WorkLimits = {};
    for (const key of Object.keys(ceilings) as (keyof WorkLimits)[]) if (Object.hasOwn(value, key)) result[key] = value[key] as number;
    return result;
}

function checkSequence(value: number): void {
    if (!sequence(value)) throw new RangeError('sequence requires a nonnegative safe integer below Number.MAX_SAFE_INTEGER');
}

function timeout(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > 120_000) throw new RangeError('timeoutMs must be 1..120000');
    return value;
}

function checkBodySize(body: string, queryVersion: 2 | 3): void {
    const bytes = encoder.encode(body).byteLength;
    if (queryVersion === CLOUD_QUERY_VERSION ? bytes > MAX_CLOUD_REQUEST : bytes > MAX_REQUEST) {
        throw new RangeError(queryVersion === CLOUD_QUERY_VERSION ? 'request exceeds 1 MiB' : 'request exceeds 64 KiB');
    }
}

function parseRetryAfter(value: string | null): number | undefined {
    if (value === null) return undefined;
    if (/^\d{1,6}$/.test(value.trim())) return Number(value.trim()) * 1000;
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function httpCode(status: number | undefined): string {
    return status === 401 ? 'FDB_AUTH' : status === 403 ? 'FDB_FORBIDDEN' : status === 409 ? 'FDB_CONFLICT' : status === 429 || status === 413 ? 'FDB_LIMIT' : status === 503 ? 'FDB_UNAVAILABLE' : 'FDB_REMOTE';
}

function redactMessage(message: string, token: string): string {
    return (token ? message.replaceAll(token, '[redacted]') : message).slice(0, 2048);
}

function safeMessage(reply: ReplyEnvelope | null, token: string): string {
    const error = reply?.error;
    return redactMessage(typeof error === 'string' ? error : plainObject(error) && typeof error.message === 'string' ? error.message : 'Database request was rejected', token);
}
