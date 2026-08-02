import type {
  ColumnOptions,
  DraftRelation,
  EntityOptions,
  EntityTarget,
  IndexOptions,
  JoinColumnOptions,
  JoinTableOptions,
  LifecycleEvent,
} from "./types.js";

export interface DraftColumn {
  readonly propertyName: string;
  readonly reflectedType?: unknown;
  readonly options: ColumnOptions;
  readonly flags?: {
    readonly createDate?: boolean;
    readonly updateDate?: boolean;
    readonly deleteDate?: boolean;
    readonly version?: boolean;
  };
}

export interface DraftIndex {
  readonly properties: readonly string[];
  readonly options: IndexOptions;
}

export interface DraftEntity {
  target: EntityTarget;
  options: EntityOptions;
  columns: DraftColumn[];
  relations: DraftRelation[];
  indexes: DraftIndex[];
  hooks: Map<LifecycleEvent, string[]>;
  joinColumns: Map<string, JoinColumnOptions>;
  joinTables: Map<string, JoinTableOptions>;
}

const drafts = new WeakMap<Function, DraftEntity>();

export function draftFor(target: Function): DraftEntity {
  let draft = drafts.get(target);
  if (!draft) {
    draft = {
      target: target as EntityTarget,
      options: {},
      columns: [],
      relations: [],
      indexes: [],
      hooks: new Map(),
      joinColumns: new Map(),
      joinTables: new Map(),
    };
    drafts.set(target, draft);
  }
  return draft;
}

export function getDraft(target: Function): DraftEntity | undefined {
  return drafts.get(target);
}
