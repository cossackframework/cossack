import type { ORM } from "../orm.js";
import type { SQLFragment } from "../sql/fragment.js";
import type { DatabasePlanTarget, MigrationPlanStatement } from "../migration/types.js";
import type { SQLTag } from "../sql/tag.js";

export type SeederTransaction = "auto" | "required" | "none";

export interface SeederContext {
  readonly orm: ORM;
  readonly sql: SQLTag;
  readonly signal?: AbortSignal;
}

export interface Seeder {
  readonly name: string;
  readonly transaction?: SeederTransaction;
  /** When supplied, these statements drive both planning and execution. */
  readonly operations?: readonly SQLFragment[];
  run?(context: SeederContext): void | Promise<void>;
}

/**
 * Function seeders are supported for compatibility. New applications should use
 * defineSeeder() so names and transaction requirements are explicit.
 */
export type SeederFunction = (orm: ORM) => void | Promise<void>;
export type SeederInput = Seeder | SeederFunction;

export interface SeederInfo {
  readonly name: string;
  readonly transaction: SeederTransaction;
}

export interface SeederRunOptions {
  readonly only?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface SeederResult extends SeederInfo {
  readonly durationMs: number;
  readonly usedTransaction: boolean;
}

export function defineSeeder<const T extends Seeder>(seeder: T): Readonly<T> {
  return Object.freeze(seeder);
}

export interface SeederPlanEntry extends SeederInfo {
  readonly direction: "seed";
  readonly target: DatabasePlanTarget;
  readonly statements: readonly MigrationPlanStatement[];
  readonly affectedObjects: readonly string[];
  readonly complete: boolean;
  readonly reason?: string;
  readonly atomicity: "transaction" | "batch" | "none";
  readonly limitations: readonly string[];
}
