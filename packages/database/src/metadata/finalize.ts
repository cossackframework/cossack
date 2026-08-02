import { MetadataError } from "../errors.js";
import type { LogicalType } from "../schema/types.js";
import { defaultNamingStrategy, type NamingStrategy } from "./naming.js";
import { getDraft } from "./store.js";
import type {
  ColumnMetadata,
  EntityMetadata,
  EntityTarget,
  LifecycleEvent,
  RelationMetadata,
} from "./types.js";

function inferType(reflected: unknown): LogicalType | undefined {
  if (reflected === String) return "varchar";
  if (reflected === Number) return "integer";
  if (reflected === Boolean) return "boolean";
  if (reflected === Date) return "datetime";
  if (reflected === Uint8Array || reflected === ArrayBuffer) return "blob";
  return undefined;
}

function enumValues(value: import("./types.js").ColumnOptions["enum"]): readonly string[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  return [...new Set(Object.values(value).filter((item): item is string => typeof item === "string"))];
}

function inverseProperty(callback?: (object: object) => unknown): string | undefined {
  if (!callback) return undefined;
  let property: string | undefined;
  const proxy = new Proxy({}, {
    get: (_target, key) => {
      property ??= String(key);
      return proxy;
    },
  });
  callback(proxy);
  return property;
}

export function finalizeMetadata(
  targets: readonly EntityTarget[],
  naming: NamingStrategy = defaultNamingStrategy,
): readonly EntityMetadata[] {
  const targetSet = new Set(targets);
  const names = new Set<string>();
  const tables = new Set<string>();
  const preliminary = new Map<EntityTarget, {
    modelName: string;
    tableName: string;
    draft: NonNullable<ReturnType<typeof getDraft>>;
  }>();

  for (const target of targets) {
    const draft = getDraft(target);
    if (!draft) throw new MetadataError(`${target.name} is missing @Entity().`);
    const modelName = draft.options.name ?? target.name;
    const tableName = draft.options.tableName ?? naming.tableName(modelName);
    if (names.has(modelName)) throw new MetadataError(`Duplicate entity name "${modelName}".`);
    if (tables.has(tableName)) throw new MetadataError(`Duplicate table name "${tableName}".`);
    names.add(modelName);
    tables.add(tableName);
    preliminary.set(target, { modelName, tableName, draft });
  }

  return Object.freeze(targets.map((target): EntityMetadata => {
    const item = preliminary.get(target);
    if (!item) throw new MetadataError(`Entity ${target.name} was not registered.`);
    const propertyNames = new Set<string>();
    const physicalNames = new Set<string>();
    const columns: ColumnMetadata[] = item.draft.columns.map((draft): ColumnMetadata => {
      if (propertyNames.has(draft.propertyName)) {
        throw new MetadataError(`${item.modelName}.${draft.propertyName} is declared more than once.`);
      }
      propertyNames.add(draft.propertyName);
      const logicalType = draft.options.type ?? inferType(draft.reflectedType);
      if (!logicalType) {
        throw new MetadataError(
          `${item.modelName}.${draft.propertyName} has an ambiguous type. ` +
          "Specify @Column({ type: ... }) for JSON, decimal, enum, array, union, or custom values.",
        );
      }
      if (draft.options.array && logicalType !== "json" && logicalType !== "enum") {
        throw new MetadataError(`${item.modelName}.${draft.propertyName}: arrays require an explicit json or enum type.`);
      }
      const columnName = draft.options.name ?? naming.columnName(draft.propertyName);
      if (physicalNames.has(columnName)) {
        throw new MetadataError(`Duplicate column "${item.tableName}.${columnName}".`);
      }
      physicalNames.add(columnName);
      const values = enumValues(draft.options.enum);
      return Object.freeze({
        propertyName: draft.propertyName,
        columnName,
        logicalType,
        nullable: draft.options.nullable ?? false,
        primary: draft.options.primary ?? false,
        generated: draft.options.generated ?? false,
        unique: draft.options.unique ?? false,
        ...(
          draft.options.length === undefined && logicalType !== "varchar"
            ? {}
            : { length: draft.options.length ?? 255 }
        ),
        ...(draft.options.precision === undefined ? {} : { precision: draft.options.precision }),
        ...(draft.options.scale === undefined ? {} : { scale: draft.options.scale }),
        ...(draft.options.default === undefined ? {} : { default: draft.options.default }),
        ...(values === undefined ? {} : { enumValues: values }),
        ...(draft.options.array === undefined ? {} : { array: draft.options.array }),
        ...(draft.options.renamedFrom === undefined ? {} : { renamedFrom: draft.options.renamedFrom }),
        insert: draft.options.insert ?? true,
        update: draft.options.update ?? true,
        select: draft.options.select ?? true,
        ...draft.flags,
        ...(draft.reflectedType === undefined ? {} : { reflectedType: draft.reflectedType }),
      });
    });
    const primaryColumns = columns.filter((column) => column.primary);
    if (primaryColumns.length === 0 && !item.draft.options.virtual) {
      throw new MetadataError(`${item.modelName} requires at least one primary column.`);
    }
    if (primaryColumns.length > 1 && primaryColumns.some((column) => column.generated)) {
      throw new MetadataError(`${item.modelName} cannot use generated columns in a composite primary key.`);
    }

    const relations = item.draft.relations.map((draft): RelationMetadata => {
      let relationTarget: EntityTarget;
      try {
        relationTarget = draft.target();
      } catch (cause) {
        throw new MetadataError(`Could not resolve relation ${item.modelName}.${draft.propertyName}.`, cause);
      }
      if (!targetSet.has(relationTarget)) {
        throw new MetadataError(
          `${item.modelName}.${draft.propertyName} targets unregistered entity ${relationTarget.name}. ` +
          "Include every relation target in createORM({ entities }).",
        );
      }
      const targetItem = preliminary.get(relationTarget);
      if (!targetItem) throw new MetadataError("Internal relation metadata error.");
      const targetDraft = targetItem.draft;
      const targetPrimary = targetDraft.columns.find((column) => column.options.primary)?.propertyName;
      const inverse = inverseProperty(draft.inverse);
      if (inverse && !targetDraft.relations.some((relation) => relation.propertyName === inverse)) {
        throw new MetadataError(
          `${item.modelName}.${draft.propertyName} points to missing inverse ${targetItem.modelName}.${inverse}.`,
        );
      }
      const owner = draft.kind === "many-to-one" || Boolean(draft.joinColumn) || Boolean(draft.joinTable);
      const cascade = draft.options.cascade === true
        ? ["insert", "update"] as const
        : (draft.options.cascade === false ? [] : (draft.options.cascade ?? []));
      const referencedProperty = draft.joinColumn?.referencedColumnName ?? targetPrimary;
      const targetColumnDraft = targetDraft.columns.find(
        (column) => column.propertyName === referencedProperty,
      );
      const referencedColumn = referencedProperty
        ? (targetColumnDraft?.options.name ?? naming.columnName(referencedProperty))
        : undefined;
      const joinColumn = owner && draft.kind !== "many-to-many" && referencedColumn
        ? (draft.joinColumn?.name ?? naming.relationJoinColumn(draft.propertyName, referencedColumn))
        : undefined;
      const ownerPrimaryDraft = item.draft.columns.find((column) => column.options.primary);
      const inversePrimaryDraft = targetDraft.columns.find((column) => column.options.primary);
      const ownerPrimaryProperty = draft.joinTable?.joinColumn?.referencedColumnName ??
        ownerPrimaryDraft?.propertyName;
      const inversePrimaryProperty = draft.joinTable?.inverseJoinColumn?.referencedColumnName ??
        inversePrimaryDraft?.propertyName;
      const ownerPrimaryColumn = columns.find((column) => column.propertyName === ownerPrimaryProperty);
      const inversePrimaryType = inversePrimaryDraft?.options.type ?? inferType(inversePrimaryDraft?.reflectedType);
      const inversePrimaryColumn = inversePrimaryProperty
        ? (inversePrimaryDraft?.options.name ?? naming.columnName(inversePrimaryProperty))
        : undefined;
      const joinTable = draft.joinTable &&
        ownerPrimaryColumn &&
        inversePrimaryProperty &&
        inversePrimaryColumn &&
        inversePrimaryType
        ? {
            name: draft.joinTable.name ?? naming.joinTableName(item.tableName, draft.propertyName, targetItem.tableName),
            joinColumn: draft.joinTable.joinColumn?.name ?? `${item.tableName}_id`,
            inverseJoinColumn: draft.joinTable.inverseJoinColumn?.name ?? `${targetItem.tableName}_id`,
            referencedColumn: ownerPrimaryColumn.columnName,
            referencedProperty: ownerPrimaryColumn.propertyName,
            referencedLogicalType: ownerPrimaryColumn.logicalType,
            inverseReferencedColumn: inversePrimaryColumn,
            inverseReferencedProperty: inversePrimaryProperty,
            inverseReferencedLogicalType: inversePrimaryType,
          }
        : undefined;
      if (draft.joinTable && !joinTable) {
        throw new MetadataError(
          `Cannot resolve primary columns for join table ${item.modelName}.${draft.propertyName}.`,
        );
      }
      return {
        propertyName: draft.propertyName,
        kind: draft.kind,
        targetEntity: targetItem.modelName,
        targetTableName: targetItem.tableName,
        ...(inverse === undefined ? {} : { inverseProperty: inverse }),
        owner,
        nullable: draft.options.nullable ?? true,
        physical: draft.options.createForeignKeyConstraints ?? true,
        ...(joinColumn === undefined ? {} : { joinColumn }),
        ...(referencedColumn === undefined ? {} : { referencedColumn }),
        ...(referencedProperty === undefined ? {} : { referencedProperty }),
        ...(joinTable === undefined ? {} : { joinTable }),
        cascade,
        ...(draft.options.onDelete === undefined ? {} : { onDelete: draft.options.onDelete }),
        target: relationTarget,
      };
    });

    for (const relation of relations) {
      if (!relation.owner || !relation.physical || !relation.joinColumn || relation.kind === "many-to-many") continue;
      const existing = columns.find((column) => column.columnName === relation.joinColumn);
      if (existing) {
        Object.defineProperty(relation, "joinProperty", {
          value: existing.propertyName,
          enumerable: true,
        });
        continue;
      }
      const targetItem = preliminary.get(relation.target);
      const targetDraft = targetItem?.draft.columns.find(
        (column) => column.propertyName === relation.referencedProperty,
      );
      const logicalType = targetDraft?.options.type ?? inferType(targetDraft?.reflectedType);
      if (!logicalType) {
        throw new MetadataError(
          `Cannot infer join-column type for ${item.modelName}.${relation.propertyName}; ` +
          "declare the referenced primary column with an explicit type.",
        );
      }
      const propertyName = `${relation.propertyName}${(relation.referencedProperty ?? "id")
        .replace(/^./, (value) => value.toUpperCase())}`;
      const shadow: ColumnMetadata = Object.freeze({
        propertyName,
        columnName: relation.joinColumn,
        logicalType,
        nullable: relation.nullable,
        primary: false,
        generated: false,
        unique: relation.kind === "one-to-one",
        insert: true,
        update: true,
        select: true,
      });
      columns.push(shadow);
      physicalNames.add(shadow.columnName);
      Object.defineProperty(relation, "joinProperty", {
        value: propertyName,
        enumerable: true,
      });
    }
    relations.forEach(Object.freeze);

    const indexes = item.draft.indexes.map((index, indexNumber) => {
      if (index.properties.length === 0) throw new MetadataError(`Index ${indexNumber} on ${item.modelName} has no columns.`);
      const physical = index.properties.map((property) => {
        const column = columns.find((candidate) => candidate.propertyName === property);
        if (!column) throw new MetadataError(`Index on ${item.modelName} references missing property "${property}".`);
        return column.columnName;
      });
      return Object.freeze({
        name: index.options.name ?? `idx_${item.tableName}_${physical.join("_")}`,
        columns: physical,
        unique: index.options.unique ?? false,
      });
    });

    const hooks = new Map<LifecycleEvent, readonly string[]>();
    for (const [event, methods] of item.draft.hooks) hooks.set(event, Object.freeze([...methods]));
    return Object.freeze({
      target,
      modelName: item.modelName,
      tableName: item.tableName,
      ...(item.draft.options.renamedFrom === undefined ? {} : { renamedFrom: item.draft.options.renamedFrom }),
      columns: Object.freeze(columns),
      relations: Object.freeze(relations),
      indexes: Object.freeze(indexes),
      virtual: item.draft.options.virtual ?? false,
      primaryColumns: Object.freeze(primaryColumns),
      hooks,
      columnByProperty: new Map(columns.map((column) => [column.propertyName, column])),
    });
  }));
}
