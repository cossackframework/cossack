import { encodeDateTime } from "../codec.js";
import type { DatabaseValue, Dialect, QueryResult } from "../adapter/types.js";

const SQL_FRAGMENT = Symbol.for("@cossackframework/database/sql-fragment");

export type SQLPrimitive = DatabaseValue | undefined;

export type SQLNode =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "value"; readonly value: SQLPrimitive }
  | { readonly kind: "identifier"; readonly path: readonly string[] }
  | { readonly kind: "unsafe"; readonly value: string }
  /** A column type by its logical name, written as the database's own type when the statement is compiled. */
  | { readonly kind: "type"; readonly logicalType: string; readonly options?: Readonly<Record<string, unknown>> }
  /** A JSON value as a parameter the database compares as JSON, not as text. */
  | { readonly kind: "json"; readonly value: string }
  | { readonly kind: "fragment"; readonly value: SQLFragment };

export interface CompiledQuery {
  readonly text: string;
  readonly parameters: readonly DatabaseValue[];
}

export class SQLFragment<Result = unknown> {
  readonly [SQL_FRAGMENT] = true;
  readonly nodes: readonly SQLNode[];
  readonly resultType?: Result;

  constructor(nodes: readonly SQLNode[]) {
    this.nodes = Object.freeze([...nodes]);
  }

  append(fragment: SQLFragment): SQLFragment<Result> {
    return new SQLFragment([...this.nodes, { kind: "fragment", value: fragment }]);
  }
}

export interface ExecutableSQL<Result = Record<string, unknown>> extends SQLFragment<Result> {
  then<TResult1 = QueryResult<Result>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<Result>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

export function isSQLFragment(value: unknown): value is SQLFragment {
  return typeof value === "object" && value !== null && SQL_FRAGMENT in value;
}

export function compileSQL(fragment: SQLFragment, dialect: Dialect): CompiledQuery {
  const parameters: DatabaseValue[] = [];
  let text = "";

  const visit = (nodes: readonly SQLNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "text" || node.kind === "unsafe") {
        text += node.value;
      } else if (node.kind === "type") {
        text += dialect.mapType(node.logicalType, node.options ? { ...node.options } : {});
      } else if (node.kind === "json") {
        parameters.push(node.value);
        const placeholder = dialect.placeholder(parameters.length);
        // SQLite keeps JSON as text, so the text is the value. The others need the cast:
        // MySQL compares a JSON column with a bare string as with a JSON string.
        text += dialect.name === "postgres" ? `${placeholder}::jsonb`
          : dialect.name === "mysql" ? `CAST(${placeholder} AS JSON)` : placeholder;
      } else if (node.kind === "identifier") {
        text += node.path.map((part) => dialect.quoteIdentifier(part)).join(".");
      } else if (node.kind === "fragment") {
        visit(node.value.nodes);
      } else {
        // Raw Date parameters use the same per-dialect text the ORM stores, so
        // raw comparisons such as `expires_at > ${new Date()}` match ORM rows.
        const value = node.value === undefined ? null
          : node.value instanceof Date ? encodeDateTime(node.value, dialect.name) : node.value;
        parameters.push(value);
        text += dialect.placeholder(parameters.length);
      }
    }
  };
  visit(fragment.nodes);
  return Object.freeze({ text, parameters: Object.freeze(parameters) });
}
