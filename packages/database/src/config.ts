import type { Adapter, ORMLogger } from "./adapter/types.js";
import type { EntityTarget } from "./metadata/types.js";
import type { Migration } from "./migration/types.js";
import type { NamingStrategy } from "./metadata/naming.js";
import type { SeederInput } from "./seeding/types.js";

export interface ORMConfig {
  readonly entities: readonly EntityTarget[];
  readonly adapter: Adapter | ((context: ORMToolingContext) => Adapter | Promise<Adapter>);
  readonly migrations?: readonly Migration[];
  /** Directory used by model-first migration generation. Defaults to `migrations`. */
  readonly migrationDirectory?: string;
  /** Model schema snapshot used for migration diffs. Defaults inside `migrationDirectory`. */
  readonly schemaSnapshot?: string;
  readonly seeds?: readonly SeederInput[];
  readonly namingStrategy?: NamingStrategy;
  readonly logger?: ORMLogger;
}

/** Node-only tooling passes this context to the application's adapter factory. */
export interface ORMToolingContext {
  readonly cwd: string;
  readonly configPath: string;
  readonly environment?: string;
  readonly target: "local" | "remote";
  /** The command inspects metadata/state and must not apply changes. */
  readonly readOnly: boolean;
}

export function defineConfig<const T extends ORMConfig>(config: T): T {
  return Object.freeze(config);
}
