import type { DialectName, QueryResult } from "./adapter/types.js";
import { ScopeError } from "./errors.js";
import { currentORM } from "./scope.js";
import type { SQLFragment } from "./sql/fragment.js";

function scopedORM(what: string) {
  const orm = currentORM();
  if (!orm) throw new ScopeError(`${what} was used outside an ORM.run() scope.`);
  return orm;
}

/**
 * Run statements as one unit in the current ORM scope, and give each one's result: one
 * transaction, or one provider batch where there is none (D1, RomeDB). See `ORM.atomic()`.
 */
export function atomic(statements: readonly SQLFragment[]): Promise<readonly QueryResult[]> {
  return scopedORM("atomic()").atomic(statements);
}

/** The SQL dialect of the current ORM scope, for the few statements that differ between databases. */
export function currentDialect(): DialectName {
  return scopedORM("currentDialect()").driver.dialect;
}
