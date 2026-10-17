// Service-protocol client (Web APIs only)
export {
    connect,
    connectWithInfo,
    normalizeUrl,
    validatePrepared,
    preparedRequestId,
    ClientError,
    RemoteDatabase,
    type Client,
    type Statement,
    type RequestOptions,
    type ReadOptions,
    type WriteOptions,
    type WorkLimits,
    type PreparedWrite,
    type QueryResult,
    type BatchResult,
    type ExecutionWork,
    type Capabilities,
    type DatabaseInfo,
    type ConnectOptions,
    type WarmResult,
    type Outcome,
} from './client';

// Typed values and codecs
export { Float64, RecordId, Vector, encodeValue, decodeValue, type Value, type PortableValue } from './values';
export { toTransport, fromTransport, TRANSPORT_VERSION, type TransportValue } from './transport';
export { objects, first, one, scalar, affected, DuplicateColumnError, CardinalityError, type Row } from './rows';

// Request bindings, engine preflight and exact recovery
export {
    FastDB,
    createFastDB,
    compareVersions,
    REQUIRED_ENGINE_VERSION,
    EngineVersionError,
    UncertainWriteError,
    type FastDBOptions,
    type FastDBWorkLimits,
    type FastDBRetryOptions,
    type ReadCallOptions,
    type WriteCallOptions,
    type Reconciler,
    type RecoveryReport,
} from './database';
export {
    MemoryPendingWriteStore,
    PendingWriteConflictError,
    encodePendingWrite,
    decodePendingWrite,
    type PendingWrite,
    type PendingWriteStore,
} from './pending';

// D1-shaped facade for portable SQL ledgers
export { sqlDatabase, numberPlaceholders, type SqlDatabase, type SqlStatement, type SqlBound, type SqlDatabaseOptions } from './sql';
