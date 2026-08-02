import type { ORM } from "../orm.js";
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
  run(context: SeederContext): void | Promise<void>;
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
