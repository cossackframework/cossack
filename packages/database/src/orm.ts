import { inspectProviderCapabilities } from "./runtime-capabilities.js";
import { inspectFinalizedMetadata } from "./metadata/inspection.js";
import { redactSqlStructure } from "./query/diagnostics.js";
import type {
  Adapter,
  Driver,
  ORMLogger,
  QueryOperation,
  QueryResult,
  ScopeStorage,
} from "./adapter/types.js";
import { decodeValue, encodeValue } from "./codec.js";
import { ConfigurationError, QueryError, UnsupportedCapabilityError } from "./errors.js";
import { ModelManager } from "./entity/manager.js";
import { defaultSelectColumns } from "./query/builder.js";
import type { BaseEntity } from "./entity/base-entity.js";
import { finalizeMetadata } from "./metadata/finalize.js";
import { defaultNamingStrategy, type NamingStrategy } from "./metadata/naming.js";
import type {
  ColumnMetadata,
  EntityMetadata,
  EntityTarget,
  LifecycleEvent,
} from "./metadata/types.js";
import { In, type EntityShape } from "./query/types.js";
import { dialectFor } from "./dialect/dialects.js";
import { registerORM, unregisterORM } from "./scope.js";
import type { OrmSchema } from "./schema/types.js";
import { compileSQL, SQLFragment } from "./sql/fragment.js";
import { createSQLTag, type SQLTag } from "./sql/tag.js";

interface ScopeContext {
  readonly root: ORM;
  readonly orm: ORM;
  readonly driver: Driver;
  readonly transactionDepth: number;
}

interface EntityState {
  readonly metadata: EntityMetadata;
  readonly original: Record<string, unknown>;
  readonly raw: Record<string, unknown>;
  isNew: boolean;
}

export interface ORMOptions {
  readonly adapter: Adapter;
  readonly entities: readonly EntityTarget[];
  readonly namingStrategy?: NamingStrategy;
  readonly logger?: ORMLogger | ((event: import("./adapter/types.js").LoggerEvent) => void);
}

function serializeMetadata(metadata: EntityMetadata): OrmSchema["entities"][number] {
  return {
    modelName: metadata.modelName,
    tableName: metadata.tableName,
    ...(metadata.renamedFrom === undefined ? {} : { renamedFrom: metadata.renamedFrom }),
    columns: metadata.columns.map(({ reflectedType: _reflectedType, ...column }) => column),
    relations: metadata.relations.map(({ target: _target, ...relation }) => relation),
    indexes: metadata.indexes,
    virtual: metadata.virtual,
  };
}

function inferOperation(text: string): QueryOperation {
  const keyword = /^\s*(\w+)/.exec(text)?.[1]?.toLowerCase();
  if (keyword === "select" || keyword === "with" || keyword === "pragma" || keyword === "show") return "select";
  if (keyword === "insert") return "insert";
  if (keyword === "update") return "update";
  if (keyword === "delete") return "delete";
  if (["create", "alter", "drop", "truncate"].includes(keyword ?? "")) return "ddl";
  return "raw";
}

export class ORM {
  readonly driver: Driver;
  readonly tooling: Adapter["tooling"];
  readonly metadata: readonly EntityMetadata[];
  readonly sql: SQLTag;
  private readonly metadataByTarget = new Map<EntityTarget, EntityMetadata>();
  private readonly metadataByName = new Map<string, EntityMetadata>();
  private readonly managers = new Map<EntityTarget, ModelManager<BaseEntity>>();
  private readonly states = new WeakMap<object, EntityState>();
  private readonly scope: ScopeStorage<ScopeContext> | undefined;
  private readonly fallbackScopes: ScopeContext[] = [];
  private readonly logger?: ORMOptions["logger"];
  private closed = false;

  constructor(options: ORMOptions) {
    if (!options.adapter?.driver) throw new ConfigurationError("createORM() requires an adapter.");
    this.driver = options.adapter.driver;
    this.tooling = options.adapter.tooling;
    this.scope = options.adapter.scope as ScopeStorage<ScopeContext> | undefined;
    this.logger = options.logger;
    this.metadata = finalizeMetadata(options.entities, options.namingStrategy ?? defaultNamingStrategy);
    for (const metadata of this.metadata) {
      for (const column of metadata.columns) {
        if (column.generated === "identity" && !this.inspectCapabilities().generated.identity) {
          throw new UnsupportedCapabilityError(`generated identity ${metadata.modelName}.${column.propertyName}`, this.driver.dialect);
        }
        if (column.generated === "increment" && this.driver.dialect === "sqlite" && (!column.primary || column.logicalType !== "integer")) {
          throw new UnsupportedCapabilityError(`SQLite integer primary increment ${metadata.modelName}.${column.propertyName}`, this.driver.dialect);
        }
        if (column.array && this.driver.dialect !== "postgres") {
          throw new UnsupportedCapabilityError(`native array ${metadata.modelName}.${column.propertyName}`, this.driver.dialect);
        }
      }
      this.metadataByTarget.set(metadata.target, metadata);
      this.metadataByName.set(metadata.modelName, metadata);
    }
    this.sql = createSQLTag((fragment) => this.executeFragment<unknown>(fragment));
    registerORM(this);
  }

  run<T>(callback: () => T): T {
    this.assertOpen();
    const current = this.context();
    if (current?.root === this) return callback();
    const context: ScopeContext = { root: this, orm: this, driver: this.driver, transactionDepth: 0 };
    if (this.scope) return this.scope.run(context, callback);
    this.fallbackScopes.push(context);
    let result: T;
    try {
      result = callback();
    } catch (cause) {
      this.fallbackScopes.pop();
      throw cause;
    }
    if (result instanceof Promise) {
      return result.finally(() => {
        const index = this.fallbackScopes.lastIndexOf(context);
        if (index >= 0) this.fallbackScopes.splice(index, 1);
      }) as T;
    }
    this.fallbackScopes.pop();
    return result;
  }

  inspectMetadata() { return inspectFinalizedMetadata(this.metadata); }

  inspectCapabilities() {
    const descriptor = Object.getOwnPropertyDescriptor(this.tooling ?? {}, "provider");
    return inspectProviderCapabilities(this.driver, descriptor && "value" in descriptor ? descriptor.value : undefined);
  }

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    this.assertOpen();
    const current = this.context();
    if (!current) return this.run(() => this.transaction(callback));
    if (current.transactionDepth > 0) {
      if (!current.driver.capabilities.savepoints) {
        throw new UnsupportedCapabilityError("nested transactions/savepoints", current.driver.dialect);
      }
      const savepoint = `cossack_sp_${current.transactionDepth + 1}`;
      await current.driver.execute({ text: `SAVEPOINT ${savepoint}`, parameters: [] }, "raw");
      const nested: ScopeContext = { ...current, transactionDepth: current.transactionDepth + 1 };
      try {
        const result = await this.runContext(nested, callback);
        await current.driver.execute({ text: `RELEASE SAVEPOINT ${savepoint}`, parameters: [] }, "raw");
        return result;
      } catch (cause) {
        await current.driver.execute({ text: `ROLLBACK TO SAVEPOINT ${savepoint}`, parameters: [] }, "raw");
        throw cause;
      }
    }
    if (!current.driver.capabilities.transactions || !current.driver.transaction) {
      throw new UnsupportedCapabilityError("interactive transactions", current.driver.dialect);
    }
    return current.driver.transaction(async (transactionDriver) => {
      const transactionORM = this.scopedClone(transactionDriver);
      const context: ScopeContext = { root: this, orm: transactionORM, driver: transactionDriver, transactionDepth: 1 };
      return this.runContext(context, callback);
    });
  }

  /** @internal Substitute a driver in this ORM's scope for disconnected tooling. */
  runWithDriver<T>(driver: Driver, callback: (orm: ORM) => T): T {
    this.assertOpen();
    const orm = this.scopedClone(driver);
    Object.defineProperty(orm, "managers", { value: new Map() });
    Object.defineProperty(orm, "states", { value: new WeakMap() });
    return this.runContext({ root: this, orm, driver, transactionDepth: 0 }, () => callback(orm));
  }

  async reserve<T>(callback: () => Promise<T>): Promise<T> {
    const current = this.context();
    if (!current) return this.run(() => this.reserve(callback));
    if (!current.driver.capabilities.reserveConnection || !current.driver.reserve) {
      throw new UnsupportedCapabilityError("connection reservation", current.driver.dialect);
    }
    return current.driver.reserve(async (reservedDriver) => {
      const reservedORM = this.scopedClone(reservedDriver);
      return this.runContext({ ...current, orm: reservedORM, driver: reservedDriver }, callback);
    });
  }

  model<T extends BaseEntity>(target: EntityTarget<T>): ModelManager<T> {
    const scoped = this.currentScopedORM();
    if (scoped !== this) return scoped.model(target);
    const metadata = this.metadataByTarget.get(target);
    if (!metadata) {
      throw new ConfigurationError(
        `${target.name} is not registered. Add it to createORM({ entities: [...] }).`,
      );
    }
    let manager = this.managers.get(target);
    if (!manager) {
      manager = new ModelManager(this, target, metadata);
      this.managers.set(target, manager);
    }
    return manager as ModelManager<T>;
  }

  schema(): OrmSchema {
    return Object.freeze({
      version: 1,
      dialect: this.driver.dialect,
      entities: Object.freeze(this.metadata.map(serializeMetadata)),
    });
  }

  async introspect(): Promise<OrmSchema> {
    if (!this.driver.introspect) {
      throw new UnsupportedCapabilityError("schema introspection", this.driver.dialect);
    }
    return this.driver.introspect();
  }

  async executeFragment<Row = Record<string, unknown>>(
    fragment: SQLFragment<unknown>,
    operation?: QueryOperation,
    signal?: AbortSignal,
  ): Promise<QueryResult<Row>> {
    this.assertOpen();
    const scoped = this.currentScopedORM();
    if (scoped !== this) return scoped.executeFragment(fragment, operation, signal);
    const compiled = compileSQL(fragment, dialectFor(this.driver.dialect));
    const finalOperation = operation ?? inferOperation(compiled.text);
    if (compiled.parameters.length > this.driver.capabilities.parameterLimit) {
      throw new UnsupportedCapabilityError("query parameter limit", this.driver.dialect);
    }
    const start = performance.now();
    try {
      const result = await this.driver.execute<Row>(compiled, finalOperation, signal);
      this.log({
        sql: redactSqlStructure(compiled.text),
        parameters: Object.freeze(compiled.parameters.map(redact)),
        durationMs: performance.now() - start,
        dialect: this.driver.dialect,
        operation: finalOperation, provider: this.inspectCapabilities().provider, outcome: "success",
      });
      return result as QueryResult<Row>;
    } catch (cause) {
      this.log({
        sql: redactSqlStructure(compiled.text),
        parameters: Object.freeze(compiled.parameters.map(redact)),
        durationMs: performance.now() - start,
        dialect: this.driver.dialect,
        operation: finalOperation, provider: this.inspectCapabilities().provider, outcome: "failure", code: "COSSACK_DATABASE_QUERY_FAILED",
      });
      throw cause instanceof QueryError
        ? cause
        : new QueryError(`Failed to execute ${finalOperation} query.`, compiled.text, cause);
    }
  }

  encode(column: ColumnMetadata, value: unknown): unknown {
    return encodeValue(column, value, this.driver.dialect);
  }

  /** Builds an entity from a database row and awaits its `@AfterLoad` hooks. */
  async hydrate<T extends BaseEntity>(metadata: EntityMetadata, row: Record<string, unknown>): Promise<T> {
    const entity = new metadata.target() as T;
    const snapshot: Record<string, unknown> = {};
    for (const column of metadata.columns) {
      if (!(column.columnName in row)) {
        // Unloaded (for example `select: false`) columns stay undefined so a class
        // field default can never be mistaken for a change and written back.
        (entity as unknown as Record<string, unknown>)[column.propertyName] = undefined;
        continue;
      }
      const value = decodeValue(column, row[column.columnName]);
      (entity as unknown as Record<string, unknown>)[column.propertyName] = value;
      snapshot[column.propertyName] = cloneValue(value);
    }
    this.states.set(entity, {
      metadata,
      original: snapshot,
      raw: { ...row },
      isNew: false,
    });
    await this.invokeHooks(entity, metadata, "after-load");
    return entity;
  }

  markNew(entity: BaseEntity, metadata: EntityMetadata): void {
    this.states.set(entity, { metadata, original: {}, raw: {}, isNew: true });
  }

  async save<T extends BaseEntity>(entity: T): Promise<T> {
    const state = this.stateFor(entity);
    const { metadata } = state;
    if (state.isNew) {
      await this.invokeHooks(entity, metadata, "before-insert");
      const now = new Date();
      for (const column of metadata.columns) {
        if (column.createDate || column.updateDate) {
          (entity as unknown as Record<string, unknown>)[column.propertyName] ??= now;
        }
        if (column.version) (entity as unknown as Record<string, unknown>)[column.propertyName] ??= 1;
        if (column.generated === "uuid") {
          (entity as unknown as Record<string, unknown>)[column.propertyName] ??= crypto.randomUUID();
        }
      }
      await this.saveCascades(entity, metadata, "insert");
      this.syncRelationColumns(entity, metadata);
      const values = this.persistedValues(entity, metadata, "insert");
      const query = this.model(metadata.target).insertQuery(values);
      if (this.driver.capabilities.returning) {
        query.returning(...metadata.columns.map((column) => column.propertyName) as never[]);
      }
      const result = await query.execute<Record<string, unknown>>();
      if (result.rows[0]) this.applyRow(entity, metadata, result.rows[0]);
      else if (metadata.primaryColumns.length === 1 && result.meta.lastInsertId !== undefined) {
        const primary = metadata.primaryColumns[0]!;
        (entity as unknown as Record<string, unknown>)[primary.propertyName] = decodeValue(primary, result.meta.lastInsertId);
      }
      state.isNew = false;
      this.refreshSnapshot(entity, state);
      await this.syncJoinTables(entity, metadata, "insert");
      await this.invokeHooks(entity, metadata, "after-insert");
      return entity;
    }

    await this.invokeHooks(entity, metadata, "before-update");
    // Cascaded relations may receive their keys here, and a reassigned owning
    // relation updates its join column, so both must run before change detection.
    await this.saveCascades(entity, metadata, "update");
    this.syncRelationColumns(entity, metadata, state.original);
    const changes: Record<string, unknown> = {};
    for (const column of metadata.columns) {
      if (!column.update || column.primary || column.updateDate || column.version) continue;
      const current = (entity as unknown as Record<string, unknown>)[column.propertyName];
      if (!equalValue(current, state.original[column.propertyName])) changes[column.propertyName] = current;
    }
    const updateDate = metadata.columns.find((column) => column.updateDate && column.update);
    if (updateDate && Object.keys(changes).length) {
      const now = new Date();
      (entity as unknown as Record<string, unknown>)[updateDate.propertyName] = now;
      changes[updateDate.propertyName] = now;
    }
    const version = metadata.columns.find((column) => column.version && column.update);
    const where = this.primaryWhere(entity, metadata);
    if (version && Object.keys(changes).length) {
      const oldVersion = Number(state.original[version.propertyName] ?? 1);
      (where as Record<string, unknown>)[version.propertyName] = oldVersion;
      changes[version.propertyName] = oldVersion + 1;
      (entity as unknown as Record<string, unknown>)[version.propertyName] = oldVersion + 1;
    }
    const relationChanged = await this.syncJoinTables(entity, metadata, "update");
    if (Object.keys(changes).length) {
      const result = await this.model(metadata.target).update(where, changes);
      if (version && result.meta.rowsAffected === 0) {
        throw new QueryError(`Optimistic lock failed for ${metadata.modelName}; the row was updated elsewhere.`);
      }
      this.refreshSnapshot(entity, state);
      await this.invokeHooks(entity, metadata, "after-update");
    } else if (relationChanged) {
      await this.invokeHooks(entity, metadata, "after-update");
    }
    return entity;
  }

  async remove<T extends BaseEntity>(entity: T): Promise<T> {
    const state = this.stateFor(entity);
    await this.invokeHooks(entity, state.metadata, "before-remove");
    const softDelete = state.metadata.columns.find((column) => column.deleteDate);
    if (softDelete) {
      (entity as unknown as Record<string, unknown>)[softDelete.propertyName] = new Date();
      await this.model(state.metadata.target).update(
        this.primaryWhere(entity, state.metadata),
        { [softDelete.propertyName]: (entity as unknown as Record<string, unknown>)[softDelete.propertyName] },
      );
    } else {
      await this.model(state.metadata.target).delete(this.primaryWhere(entity, state.metadata));
    }
    await this.invokeHooks(entity, state.metadata, "after-remove");
    return entity;
  }

  async reload<T extends BaseEntity>(entity: T): Promise<T> {
    const state = this.stateFor(entity);
    const record = entity as unknown as Record<string, unknown>;
    // Reload the default columns plus any `select: false` column this instance holds.
    const defaults = new Set(defaultSelectColumns(state.metadata));
    const columns = state.metadata.columns.filter((column) =>
      defaults.has(column) || record[column.propertyName] !== undefined || state.original[column.propertyName] !== undefined);
    const fresh = await this.model(state.metadata.target).query()
      .addSelect(...columns.map((column) => column.propertyName) as never[])
      .where(this.primaryWhere(entity, state.metadata) as never)
      .getOne();
    if (!fresh) throw new QueryError(`Cannot reload missing ${state.metadata.modelName}.`);
    for (const column of columns) {
      (entity as unknown as Record<string, unknown>)[column.propertyName] =
        (fresh as unknown as Record<string, unknown>)[column.propertyName];
    }
    this.refreshSnapshot(entity, state);
    return entity;
  }

  async loadRelations<T extends BaseEntity>(
    entities: readonly T[],
    metadata: EntityMetadata,
    relations: readonly string[],
  ): Promise<void> {
    if (!entities.length) return;
    for (const property of relations) {
      const relation = metadata.relations.find((candidate) => candidate.propertyName === property);
      if (!relation) throw new ConfigurationError(`Unknown relation ${metadata.modelName}.${property}.`);
      const targetMetadata = this.metadataByTarget.get(relation.target);
      if (!targetMetadata) throw new ConfigurationError(`Unregistered relation target ${relation.targetEntity}.`);
      if (relation.kind === "many-to-one" || relation.kind === "one-to-one" && relation.owner) {
        if (!relation.joinColumn || !relation.referencedProperty) continue;
        const targetColumn = targetMetadata.columnByProperty.get(relation.referencedProperty);
        if (!targetColumn) continue;
        const keys = [...new Set(entities.map((entity) => this.states.get(entity)?.raw[relation.joinColumn!]).filter((v) => v != null))];
        const loaded = await this.chunkedFind(targetMetadata, targetColumn.propertyName, keys);
        const byKey = new Map(loaded.map((entity) => [
          String((entity as unknown as Record<string, unknown>)[targetColumn.propertyName]),
          entity,
        ]));
        for (const entity of entities) {
          const key = this.states.get(entity)?.raw[relation.joinColumn];
          (entity as unknown as Record<string, unknown>)[property] = key == null ? null : (byKey.get(String(key)) ?? null);
        }
      } else if (relation.kind === "one-to-many" || relation.kind === "one-to-one") {
        // One-to-many, and the inverse side of a one-to-one: the target holds the join column.
        const single = relation.kind === "one-to-one";
        const inverse = targetMetadata.relations.find((candidate) => candidate.propertyName === relation.inverseProperty);
        // The child's join column references this field, which is not always the primary key
        // (for example `@JoinColumn({ referencedColumnName: "email" })`).
        const ownerColumn = inverse?.referencedProperty
          ? metadata.columnByProperty.get(inverse.referencedProperty)
          : metadata.primaryColumns[0];
        if (!inverse?.joinColumn || !ownerColumn) continue;
        const keys = [...new Set(entities.map((entity) => (entity as unknown as Record<string, unknown>)[ownerColumn.propertyName])
          .filter((value) => value != null))];
        const loaded = await this.chunkedFindPhysical(targetMetadata, inverse.joinColumn, keys);
        const groups = new Map<string, BaseEntity[]>();
        for (const child of loaded) {
          const key = this.states.get(child)?.raw[inverse.joinColumn];
          const group = groups.get(String(key)) ?? [];
          group.push(child);
          groups.set(String(key), group);
        }
        for (const entity of entities) {
          const key = (entity as unknown as Record<string, unknown>)[ownerColumn.propertyName];
          const group = groups.get(String(key));
          (entity as unknown as Record<string, unknown>)[property] = single ? (group?.[0] ?? null) : (group ?? []);
        }
      } else if (relation.kind === "many-to-many") {
        const ownerRelation = relation.joinTable
          ? relation
          : targetMetadata.relations.find(
              (candidate) =>
                candidate.kind === "many-to-many" &&
                candidate.joinTable &&
                candidate.inverseProperty === relation.propertyName,
            );
        const join = ownerRelation?.joinTable;
        if (!ownerRelation || !join) {
          throw new ConfigurationError(
            `Many-to-many relation ${metadata.modelName}.${property} requires @JoinTable() on one side.`,
          );
        }
        const currentIsOwner = ownerRelation === relation;
        const currentProperty = currentIsOwner
          ? join.referencedProperty
          : join.inverseReferencedProperty;
        const targetProperty = currentIsOwner
          ? join.inverseReferencedProperty
          : join.referencedProperty;
        const currentJoinColumn = currentIsOwner
          ? join.joinColumn
          : join.inverseJoinColumn;
        const targetJoinColumn = currentIsOwner
          ? join.inverseJoinColumn
          : join.joinColumn;
        const keys = entities.map(
          (entity) => (entity as unknown as Record<string, unknown>)[currentProperty],
        );
        const junctionRows: Record<string, unknown>[] = [];
        const limit = Math.max(1, this.driver.capabilities.parameterLimit);
        for (let index = 0; index < keys.length; index += limit) {
          const chunk = keys.slice(index, index + limit);
          const result = await this.executeFragment<Record<string, unknown>>(this.sql.fragment`
            SELECT ${this.sql.id(currentJoinColumn)}, ${this.sql.id(targetJoinColumn)}
            FROM ${this.sql.id(join.name)}
            WHERE ${this.sql.id(currentJoinColumn)} IN (${this.sql.join(chunk as never[])})
          `, "select");
          junctionRows.push(...result.rows);
        }
        const targetKeys = [...new Set(junctionRows.map((row) => row[targetJoinColumn]))];
        const loaded = await this.chunkedFind(targetMetadata, targetProperty, targetKeys);
        const targetMap = new Map(loaded.map((entity) => [
          String((entity as unknown as Record<string, unknown>)[targetProperty]),
          entity,
        ]));
        const groups = new Map<string, BaseEntity[]>();
        for (const row of junctionRows) {
          const target = targetMap.get(String(row[targetJoinColumn]));
          if (!target) continue;
          const key = String(row[currentJoinColumn]);
          const group = groups.get(key) ?? [];
          group.push(target);
          groups.set(key, group);
        }
        for (const entity of entities) {
          const key = String((entity as unknown as Record<string, unknown>)[currentProperty]);
          (entity as unknown as Record<string, unknown>)[property] = groups.get(key) ?? [];
        }
      } else {
        throw new UnsupportedCapabilityError(
          `automatic loading for ${relation.kind} ${metadata.modelName}.${property}`,
          this.driver.dialect,
        );
      }
    }
  }

  isCurrentScope(): boolean {
    return this.context()?.root === this;
  }

  currentScopedORM(): ORM {
    return this.context()?.orm ?? this;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    unregisterORM(this);
    await this.driver.close();
  }

  private context(): ScopeContext | undefined {
    return this.scope?.get() ?? this.fallbackScopes.at(-1);
  }

  private runContext<T>(context: ScopeContext, callback: () => T): T {
    if (this.scope) return this.scope.run(context, callback);
    this.fallbackScopes.push(context);
    let result: T;
    try {
      result = callback();
    } catch (cause) {
      this.fallbackScopes.pop();
      throw cause;
    }
    if (result instanceof Promise) {
      return result.finally(() => {
        const index = this.fallbackScopes.lastIndexOf(context);
        if (index >= 0) this.fallbackScopes.splice(index, 1);
      }) as T;
    }
    this.fallbackScopes.pop();
    return result;
  }

  private scopedClone(driver: Driver): ORM {
    const clone = Object.create(this) as ORM;
    Object.defineProperty(clone, "driver", { value: driver, enumerable: true });
    Object.defineProperty(clone, "sql", {
      value: createSQLTag((fragment) => clone.executeFragment<unknown>(fragment)),
      enumerable: true,
    });
    return clone;
  }

  private stateFor(entity: BaseEntity): EntityState {
    let state = this.states.get(entity);
    if (!state) {
      const metadata = this.metadataByTarget.get(entity.constructor as EntityTarget);
      if (!metadata) throw new ConfigurationError(`${entity.constructor.name} is not a registered entity.`);
      state = { metadata, original: {}, raw: {}, isNew: true };
      this.states.set(entity, state);
    }
    return state;
  }

  private persistedValues(
    entity: BaseEntity,
    metadata: EntityMetadata,
    mode: "insert" | "update",
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const column of metadata.columns) {
      if (!(mode === "insert" ? column.insert : column.update)) continue;
      const value = (entity as unknown as Record<string, unknown>)[column.propertyName];
      if (value === undefined && column.generated) continue;
      if (value !== undefined) values[column.propertyName] = value;
    }
    return values;
  }

  private primaryWhere(entity: BaseEntity, metadata: EntityMetadata): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    for (const primary of metadata.primaryColumns) {
      const value = (entity as unknown as Record<string, unknown>)[primary.propertyName];
      if (value === undefined || value === null) {
        throw new ConfigurationError(`${metadata.modelName}.${primary.propertyName} is required for this operation.`);
      }
      where[primary.propertyName] = value;
    }
    return where;
  }

  private applyRow(entity: BaseEntity, metadata: EntityMetadata, row: Record<string, unknown>): void {
    for (const column of metadata.columns) {
      const raw = row[column.columnName] ?? row[column.propertyName];
      if (raw !== undefined) (entity as unknown as Record<string, unknown>)[column.propertyName] = decodeValue(column, raw);
    }
  }

  private refreshSnapshot(entity: BaseEntity, state: EntityState): void {
    for (const column of state.metadata.columns) {
      state.original[column.propertyName] = cloneValue(
        (entity as unknown as Record<string, unknown>)[column.propertyName],
      );
    }
  }

  private async invokeHooks(
    entity: BaseEntity,
    metadata: EntityMetadata,
    event: LifecycleEvent,
  ): Promise<void> {
    for (const method of metadata.hooks.get(event) ?? []) {
      const callback = (entity as unknown as Record<string, unknown>)[method];
      if (typeof callback === "function") await callback.call(entity);
    }
  }

  private async saveCascades(
    entity: BaseEntity,
    metadata: EntityMetadata,
    operation: "insert" | "update",
  ): Promise<void> {
    for (const relation of metadata.relations) {
      if (!relation.cascade.includes(operation)) continue;
      const value = (entity as unknown as Record<string, unknown>)[relation.propertyName];
      for (const related of Array.isArray(value) ? value : value ? [value] : []) {
        if (related && typeof related === "object" && "save" in related) {
          await (related as BaseEntity).save();
        }
      }
    }
  }

  /**
   * Copies owning relation keys into their join column properties. For a loaded
   * entity (`original` given) an explicitly changed join column property wins over
   * a relation object that still points at the previously stored key.
   */
  private syncRelationColumns(
    entity: BaseEntity,
    metadata: EntityMetadata,
    original?: Record<string, unknown>,
  ): void {
    const record = entity as unknown as Record<string, unknown>;
    for (const relation of metadata.relations) {
      if (!relation.owner || !relation.joinProperty || !relation.referencedProperty) continue;
      const related = record[relation.propertyName];
      if (related !== null && (!related || typeof related !== "object")) continue;
      const key = related === null ? null : (related as Record<string, unknown>)[relation.referencedProperty];
      // An unsaved related entity has no key yet; never turn that into NULL.
      if (key === undefined) continue;
      if (original && relation.joinProperty in original) {
        const current = record[relation.joinProperty];
        const stored = original[relation.joinProperty];
        if (!equalValue(current, stored) && equalValue(key ?? null, stored ?? null)) continue;
      }
      record[relation.joinProperty] = key;
    }
  }

  private async syncJoinTables(
    entity: BaseEntity,
    metadata: EntityMetadata,
    operation: "insert" | "update",
  ): Promise<boolean> {
    const record = entity as unknown as Record<string, unknown>;
    let changed = false;
    for (const relation of metadata.relations) {
      const join = relation.joinTable;
      if (!join || !relation.cascade.includes(operation)) continue;
      const related = record[relation.propertyName];
      if (!Array.isArray(related)) continue;
      const ownerKey = record[join.referencedProperty];
      if (ownerKey === null || ownerKey === undefined) continue;
      const statements: { fragment: SQLFragment; operation: QueryOperation }[] = [{
        fragment: this.sql.fragment`DELETE FROM ${this.sql.id(join.name)} WHERE ${this.sql.id(join.joinColumn)} = ${ownerKey as never}`,
        operation: "delete",
      }];
      const rows = related.map((target) => ({
        [join.joinColumn]: ownerKey as import("./adapter/types.js").DatabaseValue,
        [join.inverseJoinColumn]:
          (target as Record<string, unknown>)[join.inverseReferencedProperty] as import("./adapter/types.js").DatabaseValue,
      }));
      // Each join row binds two parameters; keep every statement within the provider limit.
      const { parameterLimit, batchLimit } = this.driver.capabilities;
      const rowsPerStatement = Math.max(1, Math.min(batchLimit, Math.floor(parameterLimit / 2)));
      for (let index = 0; index < rows.length; index += rowsPerStatement) {
        statements.push({
          fragment: this.sql.fragment`INSERT INTO ${this.sql.id(join.name)} ${this.sql.values(rows.slice(index, index + rowsPerStatement))}`,
          operation: "insert",
        });
      }
      // Replacing the rows is all-or-nothing: a failed insert must not leave the DELETE applied.
      await this.executeAtomically(statements);
      changed = true;
    }
    return changed;
  }

  /**
   * Runs statements in one interactive transaction, or one provider batch (D1),
   * or sequentially when already inside a transaction or neither is available.
   */
  private async executeAtomically(
    statements: readonly { fragment: SQLFragment; operation: QueryOperation }[],
  ): Promise<void> {
    const sequential = async () => {
      for (const statement of statements) await this.executeFragment(statement.fragment, statement.operation);
    };
    const driver = this.currentScopedORM().driver;
    if (statements.length < 2 || (this.context()?.transactionDepth ?? 0) > 0) return sequential();
    if (driver.capabilities.transactions && driver.transaction) return this.transaction(sequential);
    if (driver.capabilities.batch && driver.batch) {
      if (statements.length > driver.capabilities.batchLimit) {
        throw new UnsupportedCapabilityError(
          `atomic batch of ${statements.length} statements (limit ${driver.capabilities.batchLimit})`,
          driver.dialect,
        );
      }
      const dialect = dialectFor(driver.dialect);
      const compiled = statements.map((statement) => ({
        query: compileSQL(statement.fragment, dialect),
        operation: statement.operation,
      }));
      if (compiled.some(({ query }) => query.parameters.length > driver.capabilities.parameterLimit)) {
        throw new UnsupportedCapabilityError("query parameter limit", driver.dialect);
      }
      try {
        await driver.batch(compiled);
      } catch (cause) {
        throw cause instanceof QueryError ? cause : new QueryError("Failed to execute batch.", compiled[0]!.query.text, cause);
      }
      return;
    }
    return sequential();
  }

  private async chunkedFind(
    metadata: EntityMetadata,
    property: string,
    values: readonly unknown[],
  ): Promise<BaseEntity[]> {
    const result: BaseEntity[] = [];
    const limit = Math.max(1, this.driver.capabilities.parameterLimit);
    for (let index = 0; index < values.length; index += limit) {
      const chunk = values.slice(index, index + limit);
      // The lookup property is the relation key, so load it even when it is `select: false`.
      result.push(...await this.model(metadata.target).query().addSelect(property as never)
        .where({ [property]: In(chunk) } as never).getMany());
    }
    return result;
  }

  private async chunkedFindPhysical(
    metadata: EntityMetadata,
    physicalColumn: string,
    values: readonly unknown[],
  ): Promise<BaseEntity[]> {
    const result: BaseEntity[] = [];
    const limit = Math.max(1, this.driver.capabilities.parameterLimit);
    for (let index = 0; index < values.length; index += limit) {
      const chunk = values.slice(index, index + limit);
      const fragment = this.sql.fragment`${this.sql.id(physicalColumn)} IN (${this.sql.join(chunk as never[])})`;
      result.push(...await this.model(metadata.target).query().where(fragment).getMany());
    }
    return result;
  }

  private log(event: import("./adapter/types.js").LoggerEvent): void {
    try {
      if (typeof this.logger === "function") this.logger(Object.freeze(event));
      else this.logger?.query(Object.freeze(event));
    } catch { /* Diagnostic observers do not own query success or application transactions. */ }
  }

  private assertOpen(): void {
    if (this.closed) throw new ConfigurationError("This ORM instance is closed.");
  }
}

function redact(value: unknown): string {
  if (value === null) return "<null>";
  if (value instanceof Uint8Array) return `<binary:${value.byteLength}>`;
  if (value instanceof Date) return "<date>";
  return `<${typeof value}>`;
}

/** Deep snapshot so nested mutations (for example inside JSON columns) are detected as changes. */
function cloneValue(value: unknown): unknown {
  if (value instanceof Date) return new Date(value);
  if (value instanceof Uint8Array) return value.slice();
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) copy[key] = cloneValue(item);
    return copy;
  }
  return value;
}

function equalValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return Object.is(left, right);
}

export function createORM(options: ORMOptions): ORM {
  return new ORM(options);
}
