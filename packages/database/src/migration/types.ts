import type { ORM } from "../orm.js";
import type { SchemaBuilder } from "../schema/builder.js";

export interface MigrationContext {
  readonly orm: ORM;
  readonly schema: SchemaBuilder;
}

export interface Migration {
  readonly name: string;
  /** Migration names replaced by a squashed baseline. */
  readonly replaces?: readonly string[];
  up(context: MigrationContext): Promise<void> | void;
  down(context: MigrationContext): Promise<void> | void;
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
