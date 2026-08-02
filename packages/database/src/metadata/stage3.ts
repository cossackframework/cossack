import type { DraftColumn, DraftIndex } from "./store.js";
import type {
  DraftRelation,
  JoinColumnOptions,
  JoinTableOptions,
  LifecycleEvent,
} from "./types.js";

declare global {
  interface SymbolConstructor {
    readonly metadata: symbol;
  }
}

if (Symbol.metadata === undefined) {
  Object.defineProperty(Symbol, "metadata", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Symbol.for("Symbol.metadata"),
  });
}

export interface Stage3DecoratorContext {
  readonly kind: string;
  readonly name: string | symbol;
  readonly metadata?: object;
  readonly static?: boolean;
  readonly private?: boolean;
}

export interface Stage3Draft {
  readonly columns: DraftColumn[];
  readonly relations: DraftRelation[];
  readonly indexes: DraftIndex[];
  readonly hooks: Map<LifecycleEvent, string[]>;
  readonly joinColumns: Map<string, JoinColumnOptions>;
  readonly joinTables: Map<string, JoinTableOptions>;
}

const STAGE3_DRAFT = Symbol.for("@cossackframework/database/stage3-draft");

export function isStage3Context(value: unknown): value is Stage3DecoratorContext {
  return typeof value === "object" && value !== null && "kind" in value && "name" in value;
}

export function stage3Draft(context: Stage3DecoratorContext): Stage3Draft {
  if (!context.metadata) {
    throw new TypeError(
      `Standard decorator metadata is unavailable for ${String(context.name)}. ` +
      "Import decorators from @cossackframework/database before evaluating model classes.",
    );
  }
  const metadata = context.metadata as Record<PropertyKey, unknown>;
  let draft = metadata[STAGE3_DRAFT] as Stage3Draft | undefined;
  if (!draft) {
    draft = {
      columns: [],
      relations: [],
      indexes: [],
      hooks: new Map(),
      joinColumns: new Map(),
      joinTables: new Map(),
    };
    metadata[STAGE3_DRAFT] = draft;
  }
  return draft;
}

export function getStage3Draft(context: Stage3DecoratorContext): Stage3Draft | undefined {
  return context.metadata
    ? (context.metadata as Record<PropertyKey, unknown>)[STAGE3_DRAFT] as Stage3Draft | undefined
    : undefined;
}
