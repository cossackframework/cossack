import type { ORM } from "../orm.js";
import type { SQLFragment } from "../sql/fragment.js";
import type { SchemaOperation } from "../schema/operations.js";
import type { Adapter, DialectName } from "../adapter/types.js";
import type { SchemaBuilder } from "../schema/builder.js";

export interface MigrationContext {
  readonly orm: ORM;
  readonly schema: SchemaBuilder;
}

export interface Migration {
  readonly name: string;
  /** Migration names replaced by a squashed baseline. */
  readonly replaces?: readonly string[];
  /** Declarative operations are authoritative for planning AND execution. */
  readonly operations?: { readonly up: readonly MigrationOperation[]; readonly down?: readonly MigrationOperation[] };
  up?(context: MigrationContext): Promise<void> | void;
  down?(context: MigrationContext): Promise<void> | void;
}

export interface AppliedMigration {
  readonly name: string;
  readonly checksum: string;
  readonly batch: number;
  readonly appliedAt: Date;
}

export interface MigrationStatus {
  readonly migration: Migration;
  readonly checksum: string;
  readonly applied?: AppliedMigration;
  readonly state: "pending" | "applied" | "changed";
}

export type MigrationOperation = SchemaOperation | SQLFragment;
export type DatabasePlanTarget = Readonly<NonNullable<Adapter["tooling"]> & { connectionId: string; dialect: DialectName }> | Readonly<{ connectionId: string; dialect: DialectName }>;

export interface MigrationPlanStatement {
  readonly order: number;
  readonly affectedObjects: readonly string[];
  readonly affectedObjectsComplete: boolean;
  readonly text: string;
  /** Parameter values are intentionally excluded from inspection output. */
  readonly parameterCount: number;
  readonly risk: "safe" | "destructive" | "unknown";
}

export interface MigrationPlanEntry {
  readonly name: string;
  readonly direction: "up" | "down";
  readonly target: DatabasePlanTarget;
  readonly atomicity: "transaction" | "batch" | "none";
  readonly limitations: readonly string[];
  readonly affectedObjects: readonly string[];
  readonly mode: "apply" | "revert" | "consolidate";
  readonly replaces?: readonly string[];
  readonly checksum: string;
  readonly statements: readonly MigrationPlanStatement[];
  readonly bookkeeping: readonly MigrationPlanStatement[];
  readonly complete: boolean;
  readonly reason?: string;
}
