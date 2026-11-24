export class ORMError extends Error {
  override readonly name: string = "ORMError";
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
  }
}

export class ConfigurationError extends ORMError {
  override readonly name = "ConfigurationError";
}

export class MetadataError extends ORMError {
  override readonly name = "MetadataError";
}

export class ScopeError extends ORMError {
  override readonly name = "ScopeError";
}

export class QueryError extends ORMError {
  override readonly name = "QueryError";
  constructor(
    message: string,
    readonly sql?: string,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

export class UnsupportedCapabilityError extends ORMError {
  override readonly name = "UnsupportedCapabilityError";
  constructor(
    readonly capability: string,
    readonly dialect?: string,
  ) {
    super(
      `${capability} is not supported${dialect ? ` by the ${dialect} adapter` : ""}. ` +
        "Choose an adapter with this capability or use an explicitly supported operation.",
    );
  }
}

export class DestructiveSchemaChangeError extends ORMError {
  override readonly name = "DestructiveSchemaChangeError";
}

export class MigrationError extends ORMError {
  override readonly name = "MigrationError";
}

export class SeederError extends ORMError {
  override readonly name = "SeederError";
  constructor(
    readonly seederName: string,
    cause?: unknown,
  ) {
    const detail = cause instanceof Error ? `: ${cause.message}` : "";
    super(`Seeder "${seederName}" failed${detail}`, cause);
  }
}

/** Provider codes of a write that lost to a concurrent write, or could not take its lock in time. */
const WRITE_CONFLICT_CODES = new Set<unknown>([
  "RDB_WRITE_CONFLICT",                         // RomeDB
  "SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT", 5,      // SQLite
  "40001", "40P01",                             // PostgreSQL: serialization failure, deadlock
  "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT", 1213, 1205, // MySQL
]);

/**
 * Whether a query failed because another write to the same rows won: the statement changed
 * nothing and may be tried again, or given up as "busy". Looks through the error's causes.
 */
export function isWriteConflict(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 8; depth++) {
    const { code, errno, cause } = current as { code?: unknown; errno?: unknown; cause?: unknown };
    if (WRITE_CONFLICT_CODES.has(code) || WRITE_CONFLICT_CODES.has(errno)) return true;
    current = cause;
  }
  return false;
}
