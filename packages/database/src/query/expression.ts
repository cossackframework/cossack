import { ConfigurationError } from "../errors.js";
import type { EntityMetadata } from "../metadata/types.js";
import { SQLFragment, type SQLNode } from "../sql/fragment.js";
import type { SQLTag } from "../sql/tag.js";
import type { FindOperator, FindWhere } from "./types.js";

export class ExpressionBuilder<T extends object> {
  constructor(
    private readonly metadata: EntityMetadata,
    private readonly sql: SQLTag,
    private readonly alias?: string,
    private readonly encoder?: (
      column: EntityMetadata["columns"][number],
      value: unknown,
    ) => unknown,
  ) {}

  column(property: keyof T & string): SQLFragment {
    const column = this.metadata.columnByProperty.get(property);
    if (!column) throw new ConfigurationError(`Unknown property ${this.metadata.modelName}.${property}.`);
    return this.alias ? this.sql.id(this.alias, column.columnName) : this.sql.id(column.columnName);
  }

  eq(property: keyof T & string, value: unknown): SQLFragment { return this.compare(property, "=", value); }
  ne(property: keyof T & string, value: unknown): SQLFragment { return this.compare(property, "<>", value); }
  gt(property: keyof T & string, value: unknown): SQLFragment { return this.compare(property, ">", value); }
  gte(property: keyof T & string, value: unknown): SQLFragment { return this.compare(property, ">=", value); }
  lt(property: keyof T & string, value: unknown): SQLFragment { return this.compare(property, "<", value); }
  lte(property: keyof T & string, value: unknown): SQLFragment { return this.compare(property, "<=", value); }
  like(property: keyof T & string, value: string): SQLFragment { return this.compare(property, "LIKE", value); }

  compare(property: keyof T & string, operator: string, value: unknown): SQLFragment {
    const column = this.metadata.columnByProperty.get(property);
    const encoded = column && this.encoder ? this.encoder(column, value) : value;
    return this.sql.fragment`${this.column(property)} ${this.sql.unsafe(operator)} ${encoded as import("../adapter/types.js").DatabaseValue}`;
  }

  in(property: keyof T & string, values: readonly unknown[]): SQLFragment {
    if (values.length === 0) return this.sql.fragment`1 = 0`;
    const column = this.metadata.columnByProperty.get(property);
    const encoded = column && this.encoder
      ? values.map((value) => this.encoder!(column, value))
      : values;
    return this.sql.fragment`${this.column(property)} IN (${this.sql.join(encoded as readonly import("../adapter/types.js").DatabaseValue[])})`;
  }

  isNull(property: keyof T & string): SQLFragment {
    return this.sql.fragment`${this.column(property)} IS NULL`;
  }

  and(...parts: readonly SQLFragment[]): SQLFragment {
    return joinBoolean(parts, "AND");
  }

  or(...parts: readonly SQLFragment[]): SQLFragment {
    return joinBoolean(parts, "OR");
  }

  not(part: SQLFragment): SQLFragment {
    return this.sql.fragment`NOT (${part})`;
  }
}

function joinBoolean(parts: readonly SQLFragment[], operator: "AND" | "OR"): SQLFragment {
  const nodes: SQLNode[] = [];
  parts.forEach((part, index) => {
    if (index) nodes.push({ kind: "text", value: ` ${operator} ` });
    nodes.push({ kind: "text", value: "(" }, { kind: "fragment", value: part }, { kind: "text", value: ")" });
  });
  return new SQLFragment(nodes);
}

function operatorFragment<T extends object>(
  expressions: ExpressionBuilder<T>,
  property: keyof T & string,
  operator: FindOperator,
): SQLFragment {
  switch (operator.operator) {
    case "eq": return expressions.eq(property, operator.value);
    case "ne": return expressions.ne(property, operator.value);
    case "gt": return expressions.gt(property, operator.value);
    case "gte": return expressions.gte(property, operator.value);
    case "lt": return expressions.lt(property, operator.value);
    case "lte": return expressions.lte(property, operator.value);
    case "like": return expressions.like(property, String(operator.value));
    case "in": return expressions.in(property, operator.value as readonly unknown[]);
    case "not-in": return expressions.not(expressions.in(property, operator.value as readonly unknown[]));
    case "is-null": return expressions.isNull(property);
  }
}

export function compileWhere<T extends object>(
  metadata: EntityMetadata,
  sql: SQLTag,
  where: FindWhere<T> | readonly FindWhere<T>[] | SQLFragment,
  alias?: string,
  encoder?: (
    column: EntityMetadata["columns"][number],
    value: unknown,
  ) => unknown,
): SQLFragment {
  if (where instanceof SQLFragment) return where;
  const expressions = new ExpressionBuilder<T>(metadata, sql, alias, encoder);
  if (Array.isArray(where)) {
    return expressions.or(...where.map((item) => compileWhere(metadata, sql, item, alias, encoder)));
  }
  const parts = Object.entries(where).map(([property, value]) => {
    if (typeof value === "object" && value !== null && "operator" in value) {
      return operatorFragment(expressions, property as keyof T & string, value as FindOperator);
    }
    if (value === null) return expressions.isNull(property as keyof T & string);
    return expressions.eq(property as keyof T & string, value);
  });
  return parts.length ? expressions.and(...parts) : sql.fragment`1 = 1`;
}
