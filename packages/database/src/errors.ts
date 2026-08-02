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
