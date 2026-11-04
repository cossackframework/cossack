// RomeDB's client and typed values (`@romedb/node/client`: Web APIs only, so it also runs on
// Workers). `RecordId` is RomeDB's `Record`, renamed so it does not hide TypeScript's `Record`.
export {
    connect,
    normalizeUrl,
    validatePrepared,
    ClientError,
    RemoteDatabase,
    Float64,
    Record as RecordId,
    Vector,
    encodeValue,
    decodeValue,
    type RequestOptions,
    type ReadOptions,
    type WriteOptions,
    type WorkLimits,
    type PreparedWrite,
    type QueryResult,
    type BatchResult,
    type Capabilities,
    type DatabaseFile,
    type DatabaseInfo,
    type ConnectOptions,
    type WarmResult,
    type Outcome,
    type Value,
    type PortableValue,
} from '@romedb/node/client';

// JSON transport for SSR state, RPC and plugin boundaries, and row helpers
export { toTransport, fromTransport, TRANSPORT_VERSION, type TransportValue } from './transport';
export { objects, first, one, scalar, affected, DuplicateColumnError, CardinalityError, type Row } from './rows';

// Request bindings, engine preflight and exact recovery
export {
    RomeDB,
    createRomeDB,
    compareVersions,
    REQUIRED_ENGINE_VERSION,
    EngineVersionError,
    UncertainWriteError,
    type DatabaseClient,
    type Statement,
    type RomeDBOptions,
    type RomeDBWorkLimits,
    type RomeDBRetryOptions,
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
    preparedRequestId,
    type PendingWrite,
    type PendingWriteStore,
} from './pending';

// Databases created and deleted by name: a Cloud organization or romedb serve --directory
export { organizationDatabases, type DatabaseDirectory } from './directory';

// D1-shaped facade for portable SQL ledgers
export { rqlDatabase, numberPlaceholders, type RqlDatabase, type RqlStatement, type RqlBound, type RqlDatabaseOptions } from './rql';
