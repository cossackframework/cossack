import type { DatabaseValue, Dialect, QueryResult } from "../adapter/types.js";

const SQL_FRAGMENT = Symbol.for("@cossackframework/database/sql-fragment");

export type SQLPrimitive = DatabaseValue | undefined;

export type SQLNode =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "value"; readonly value: SQLPrimitive }
  | { readonly kind: "identifier"; readonly path: readonly string[] }
  | { readonly kind: "unsafe"; readonly value: string }
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
      } else if (node.kind === "identifier") {
        text += node.path.map((part) => dialect.quoteIdentifier(part)).join(".");
      } else if (node.kind === "fragment") {
        visit(node.value.nodes);
      } else {
        const value = node.value === undefined ? null : node.value;
        parameters.push(value);
        text += dialect.placeholder(parameters.length);
      }
    }
  };
  visit(fragment.nodes);
  return Object.freeze({ text, parameters: Object.freeze(parameters) });
}
