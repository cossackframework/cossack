import type { Adapter, ORMLogger } from "./adapter/types.js";
import type { EntityTarget } from "./metadata/types.js";
import type { Migration } from "./migration/types.js";
import type { NamingStrategy } from "./metadata/naming.js";
import type { SeederInput } from "./seeding/types.js";

export interface ORMConfig {
  readonly entities: readonly EntityTarget[];
  readonly adapter: Adapter | (() => Adapter | Promise<Adapter>);
  readonly migrations?: readonly Migration[];
  readonly seeds?: readonly SeederInput[];
  readonly namingStrategy?: NamingStrategy;
  readonly logger?: ORMLogger;
}

export function defineConfig<const T extends ORMConfig>(config: T): T {
  return Object.freeze(config);
}
