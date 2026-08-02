import { draftFor } from "./store.js";
import {
  getStage3Draft,
  isStage3Context,
  stage3Draft,
  type Stage3DecoratorContext,
} from "./stage3.js";
import type {
  ColumnOptions,
  EntityOptions,
  EntityTarget,
  IndexOptions,
  JoinColumnOptions,
  JoinTableOptions,
  LifecycleEvent,
  RelationOptions,
} from "./types.js";

type ReflectWithMetadata = typeof Reflect & {
  getMetadata?(key: string, target: object, propertyKey: string | symbol): unknown;
};

function reflectedType(target: object, propertyKey: string | symbol): unknown {
  return (Reflect as ReflectWithMetadata).getMetadata?.("design:type", target, propertyKey);
}

export function Entity(options: EntityOptions | string = {}): ClassDecorator {
  return ((target: Function, context?: Stage3DecoratorContext) => {
    const draft = draftFor(target);
    if (context && isStage3Context(context)) {
      const pending = getStage3Draft(context);
      if (pending) {
        draft.columns.push(...pending.columns);
        draft.relations.push(...pending.relations);
        draft.indexes.push(...pending.indexes);
        for (const [event, methods] of pending.hooks) {
          draft.hooks.set(event, [...(draft.hooks.get(event) ?? []), ...methods]);
        }
        for (const [property, value] of pending.joinColumns) draft.joinColumns.set(property, value);
        for (const [property, value] of pending.joinTables) draft.joinTables.set(property, value);
        for (const relation of draft.relations) {
          const joinColumn = draft.joinColumns.get(relation.propertyName);
          const joinTable = draft.joinTables.get(relation.propertyName);
          if (!relation.joinColumn && joinColumn) relation.joinColumn = joinColumn;
          if (!relation.joinTable && joinTable) relation.joinTable = joinTable;
        }
      }
    }
    draft.options = typeof options === "string" ? { tableName: options } : options;
  }) as ClassDecorator;
}

function columnDecorator(options: ColumnOptions, flags?: import("./store.js").DraftColumn["flags"]): PropertyDecorator {
  return ((target: object | undefined, propertyKey: string | symbol | Stage3DecoratorContext) => {
    if (isStage3Context(propertyKey) && propertyKey.kind !== "class") {
      const propertyName = String(propertyKey.name);
      const pending = stage3Draft(propertyKey);
      const existing = pending.columns.findIndex((column) => column.propertyName === propertyName);
      const column = {
        propertyName,
        options,
        ...(flags === undefined ? {} : { flags }),
      };
      if (existing >= 0) pending.columns[existing] = column;
      else pending.columns.push(column);
      return;
    }
    if (!target) throw new TypeError("Legacy property decorators require a prototype target.");
    const draft = draftFor(target.constructor);
    const propertyName = String(propertyKey);
    const existing = draft.columns.findIndex((column) => column.propertyName === propertyName);
    const reflected = reflectedType(target, propertyKey as string | symbol);
    const column = {
      propertyName,
      ...(reflected === undefined ? {} : { reflectedType: reflected }),
      options,
      ...(flags === undefined ? {} : { flags }),
    };
    if (existing >= 0) draft.columns[existing] = column;
    else draft.columns.push(column);
  }) as PropertyDecorator;
}

export function Column(options: ColumnOptions | import("../schema/types.js").LogicalType = {}): PropertyDecorator {
  return columnDecorator(typeof options === "string" ? { type: options } : options);
}

export function PrimaryColumn(options: ColumnOptions = {}): PropertyDecorator {
  return columnDecorator({ ...options, primary: true });
}

export function PrimaryGeneratedColumn(
  strategyOrOptions: "increment" | "identity" | "uuid" | ColumnOptions = "increment",
  options: ColumnOptions = {},
): PropertyDecorator {
  const merged = typeof strategyOrOptions === "string"
    ? {
        type: strategyOrOptions === "uuid" ? "uuid" as const : "integer" as const,
        ...options,
        primary: true,
        generated: strategyOrOptions,
      }
    : {
        type: strategyOrOptions.type ??
          (strategyOrOptions.generated === "uuid" ? "uuid" as const : "integer" as const),
        ...strategyOrOptions,
        primary: true,
        generated: strategyOrOptions.generated ?? "increment",
      };
  return columnDecorator(merged);
}

export function CreateDateColumn(options: ColumnOptions = {}): PropertyDecorator {
  return columnDecorator({ type: "datetime", ...options }, { createDate: true });
}

export function UpdateDateColumn(options: ColumnOptions = {}): PropertyDecorator {
  return columnDecorator({ type: "datetime", ...options }, { updateDate: true });
}

export function DeleteDateColumn(options: ColumnOptions = {}): PropertyDecorator {
  return columnDecorator({ type: "datetime", nullable: true, ...options }, { deleteDate: true });
}

export function VersionColumn(options: ColumnOptions = {}): PropertyDecorator {
  return columnDecorator({ type: "integer", default: 1, ...options }, { version: true });
}

function relationDecorator(
  kind: import("../schema/types.js").RelationKind,
  target: () => EntityTarget,
  inverse?: ((object: object) => unknown) | RelationOptions,
  options: RelationOptions = {},
): PropertyDecorator {
  const inverseCallback = typeof inverse === "function" ? inverse : undefined;
  const finalOptions = typeof inverse === "object" ? inverse : options;
  return ((prototype: object | undefined, propertyKey: string | symbol | Stage3DecoratorContext) => {
    if (isStage3Context(propertyKey)) {
      const pending = stage3Draft(propertyKey);
      const propertyName = String(propertyKey.name);
      const relation: import("./types.js").DraftRelation = {
        propertyName,
        kind,
        target,
        ...(inverseCallback === undefined ? {} : { inverse: inverseCallback }),
        options: finalOptions,
      };
      const joinColumn = pending.joinColumns.get(propertyName);
      const joinTable = pending.joinTables.get(propertyName);
      if (joinColumn) relation.joinColumn = joinColumn;
      if (joinTable) relation.joinTable = joinTable;
      pending.relations.push(relation);
      return;
    }
    if (!prototype) throw new TypeError("Legacy relation decorators require a prototype target.");
    const draft = draftFor(prototype.constructor);
    const propertyName = String(propertyKey);
    const relation: import("./types.js").DraftRelation = {
      propertyName,
      kind,
      target,
      ...(inverseCallback === undefined ? {} : { inverse: inverseCallback }),
      options: finalOptions,
    };
    const joinColumn = draft.joinColumns.get(propertyName);
    const joinTable = draft.joinTables.get(propertyName);
    if (joinColumn) relation.joinColumn = joinColumn;
    if (joinTable) relation.joinTable = joinTable;
    draft.relations.push(relation);
  }) as PropertyDecorator;
}

type TypedInverse<T extends object> = ((object: T) => unknown) | RelationOptions;

function typedRelation<T extends object>(
  kind: import("../schema/types.js").RelationKind,
  target: () => EntityTarget<T>,
  inverse?: TypedInverse<T>,
  options?: RelationOptions,
): PropertyDecorator {
  return relationDecorator(
    kind,
    target as () => EntityTarget,
    inverse as ((object: object) => unknown) | RelationOptions | undefined,
    options,
  );
}

export function OneToOne<T extends object>(
  target: () => EntityTarget<T>,
  inverse?: TypedInverse<T>,
  options?: RelationOptions,
): PropertyDecorator {
  return typedRelation("one-to-one", target, inverse, options);
}

export function OneToMany<T extends object>(
  target: () => EntityTarget<T>,
  inverse?: TypedInverse<T>,
  options?: RelationOptions,
): PropertyDecorator {
  return typedRelation("one-to-many", target, inverse, options);
}

export function ManyToOne<T extends object>(
  target: () => EntityTarget<T>,
  inverse?: TypedInverse<T>,
  options?: RelationOptions,
): PropertyDecorator {
  return typedRelation("many-to-one", target, inverse, options);
}

export function ManyToMany<T extends object>(
  target: () => EntityTarget<T>,
  inverse?: TypedInverse<T>,
  options?: RelationOptions,
): PropertyDecorator {
  return typedRelation("many-to-many", target, inverse, options);
}

export function JoinColumn(options: JoinColumnOptions = {}): PropertyDecorator {
  return ((target: object | undefined, propertyKey: string | symbol | Stage3DecoratorContext) => {
    if (isStage3Context(propertyKey)) {
      const pending = stage3Draft(propertyKey);
      const propertyName = String(propertyKey.name);
      pending.joinColumns.set(propertyName, options);
      const relation = pending.relations.find((item) => item.propertyName === propertyName);
      if (relation) relation.joinColumn = options;
      return;
    }
    if (!target) throw new TypeError("Legacy join decorators require a prototype target.");
    const draft = draftFor(target.constructor);
    const propertyName = String(propertyKey);
    draft.joinColumns.set(propertyName, options);
    const relation = draft.relations.find(
      (item) => item.propertyName === String(propertyKey),
    );
    if (relation) relation.joinColumn = options;
  }) as PropertyDecorator;
}

export function JoinTable(options: JoinTableOptions = {}): PropertyDecorator {
  return ((target: object | undefined, propertyKey: string | symbol | Stage3DecoratorContext) => {
    if (isStage3Context(propertyKey)) {
      const pending = stage3Draft(propertyKey);
      const propertyName = String(propertyKey.name);
      pending.joinTables.set(propertyName, options);
      const relation = pending.relations.find((item) => item.propertyName === propertyName);
      if (relation) relation.joinTable = options;
      return;
    }
    if (!target) throw new TypeError("Legacy join decorators require a prototype target.");
    const draft = draftFor(target.constructor);
    const propertyName = String(propertyKey);
    draft.joinTables.set(propertyName, options);
    const relation = draft.relations.find(
      (item) => item.propertyName === String(propertyKey),
    );
    if (relation) relation.joinTable = options;
  }) as PropertyDecorator;
}

export function Index(
  nameOrProperties?: string | readonly string[] | IndexOptions,
  propertiesOrOptions?: readonly string[] | IndexOptions,
  maybeOptions: IndexOptions = {},
): ClassDecorator & PropertyDecorator {
  return ((target: object | Function | undefined, propertyKey?: string | symbol | Stage3DecoratorContext) => {
    if (isStage3Context(propertyKey) && propertyKey.kind !== "class") {
      const properties = [String(propertyKey.name)];
      const options = typeof nameOrProperties === "string"
        ? {
            ...((typeof propertiesOrOptions === "object" && !Array.isArray(propertiesOrOptions))
              ? propertiesOrOptions
              : {}),
            name: nameOrProperties,
          }
        : ((nameOrProperties as IndexOptions | undefined) ?? {});
      stage3Draft(propertyKey).indexes.push({ properties, options });
      return;
    }
    if (isStage3Context(propertyKey) && propertyKey.kind === "class") propertyKey = undefined;
    if (!target) throw new TypeError("Index decorators require a class or prototype target.");
    const constructor = typeof target === "function" ? target : target.constructor;
    let properties: readonly string[];
    let options: IndexOptions;
    if (propertyKey !== undefined) {
      properties = [String(propertyKey)];
      options = typeof nameOrProperties === "string"
        ? { ...((typeof propertiesOrOptions === "object" && !Array.isArray(propertiesOrOptions)) ? propertiesOrOptions : {}), name: nameOrProperties }
        : ((nameOrProperties as IndexOptions | undefined) ?? {});
    } else {
      properties = Array.isArray(nameOrProperties)
        ? nameOrProperties
        : (Array.isArray(propertiesOrOptions) ? propertiesOrOptions : []);
      options = typeof nameOrProperties === "string"
        ? { ...maybeOptions, name: nameOrProperties }
        : ((propertiesOrOptions as IndexOptions | undefined) ?? (nameOrProperties as IndexOptions | undefined) ?? {});
    }
    draftFor(constructor).indexes.push({ properties, options });
  }) as ClassDecorator & PropertyDecorator;
}

export function Unique(
  nameOrProperties: string | readonly string[],
  properties?: readonly string[],
): ClassDecorator {
  return Index(nameOrProperties, properties ?? { unique: true }, { unique: true }) as ClassDecorator;
}

function hook(event: LifecycleEvent): MethodDecorator {
  return ((target: object | undefined, propertyKey: string | symbol | Stage3DecoratorContext) => {
    if (isStage3Context(propertyKey)) {
      const hooks = stage3Draft(propertyKey).hooks;
      const current = hooks.get(event) ?? [];
      current.push(String(propertyKey.name));
      hooks.set(event, current);
      return;
    }
    if (!target) throw new TypeError("Legacy hook decorators require a prototype target.");
    const hooks = draftFor(target.constructor).hooks;
    const current = hooks.get(event) ?? [];
    current.push(String(propertyKey));
    hooks.set(event, current);
  }) as MethodDecorator;
}

export const BeforeInsert = (): MethodDecorator => hook("before-insert");
export const AfterInsert = (): MethodDecorator => hook("after-insert");
export const BeforeUpdate = (): MethodDecorator => hook("before-update");
export const AfterUpdate = (): MethodDecorator => hook("after-update");
export const BeforeRemove = (): MethodDecorator => hook("before-remove");
export const AfterRemove = (): MethodDecorator => hook("after-remove");
export const AfterLoad = (): MethodDecorator => hook("after-load");
