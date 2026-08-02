import type { DatabaseValue, QueryResult } from "../adapter/types.js";
import { ConfigurationError, ScopeError } from "../errors.js";
import { currentORM } from "../scope.js";
import { ExecutableFragment } from "./executable.js";
import {
  SQLFragment,
  type ExecutableSQL,
  type SQLNode,
} from "./fragment.js";

export type SQLInterpolation =
  | DatabaseValue
  | undefined
  | SQLFragment
  | readonly DatabaseValue[];

export interface SQLTag {
  <Result = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: readonly SQLInterpolation[]
  ): ExecutableSQL<Result>;
  fragment(
    strings: TemplateStringsArray,
    ...values: readonly SQLInterpolation[]
  ): SQLFragment;
  id(...path: readonly string[]): SQLFragment;
  join(values: readonly SQLInterpolation[], separator?: SQLFragment): SQLFragment;
  values(rows: Readonly<Record<string, DatabaseValue>> | readonly Readonly<Record<string, DatabaseValue>>[]): SQLFragment;
  unsafe(text: string): SQLFragment;
  execute<Result = Record<string, unknown>>(fragment: SQLFragment<Result>): Promise<QueryResult<Result>>;
  transaction<T>(callback: () => Promise<T>): Promise<T>;
  reserve<T>(callback: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function nodesFor(strings: TemplateStringsArray, values: readonly SQLInterpolation[]): SQLNode[] {
  const nodes: SQLNode[] = [];
  strings.forEach((text, index) => {
    if (text) nodes.push({ kind: "text", value: text });
    if (index >= values.length) return;
    const value = values[index];
    if (value instanceof SQLFragment) {
      nodes.push({ kind: "fragment", value });
    } else if (Array.isArray(value)) {
      value.forEach((item, itemIndex) => {
        if (itemIndex > 0) nodes.push({ kind: "text", value: ", " });
        nodes.push({ kind: "value", value: item });
      });
    } else {
      nodes.push({ kind: "value", value: value as DatabaseValue | undefined });
    }
  });
  return nodes;
}

function makeTag(
  executor?: (fragment: SQLFragment<unknown>) => Promise<QueryResult<unknown>>,
): SQLTag {
  const tag = (<Result = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: readonly SQLInterpolation[]
  ): ExecutableSQL<Result> => new ExecutableFragment<Result>(
    nodesFor(strings, values),
    async (fragment) => {
      if (executor) return executor(fragment) as Promise<QueryResult<Result>>;
      const orm = currentORM();
      if (!orm) {
        throw new ScopeError(
          "The global sql tag was awaited outside ORM.run(). " +
          "Wrap the request in orm.run(() => ...) or use orm.sql directly.",
        );
      }
      return orm.executeFragment<Result>(fragment);
    },
  )) as SQLTag;

  tag.fragment = (strings, ...values) => new SQLFragment(nodesFor(strings, values));
  tag.id = (...path) => {
    if (path.length === 0 || path.some((part) => part.length === 0)) {
      throw new ConfigurationError("sql.id() requires one or more non-empty identifier parts.");
    }
    return new SQLFragment([{ kind: "identifier", path }]);
  };
  tag.join = (values, separator = new SQLFragment([{ kind: "text", value: ", " }])) => {
    const nodes: SQLNode[] = [];
    values.forEach((value, index) => {
      if (index > 0) nodes.push({ kind: "fragment", value: separator });
      if (value instanceof SQLFragment) nodes.push({ kind: "fragment", value });
      else nodes.push({ kind: "value", value: value as DatabaseValue | undefined });
    });
    return new SQLFragment(nodes);
  };
  tag.values = (input) => {
    const rows = Array.isArray(input) ? input : [input];
    if (rows.length === 0) throw new ConfigurationError("sql.values() requires at least one row.");
    const columns = Object.keys(rows[0] ?? {});
    if (columns.length === 0) throw new ConfigurationError("sql.values() requires at least one column.");
    for (const row of rows) {
      if (Object.keys(row).join("\0") !== columns.join("\0")) {
        throw new ConfigurationError("Every sql.values() row must have identical columns in identical order.");
      }
    }
    const valueNodes: SQLNode[] = [
      { kind: "text", value: "(" },
      ...columns.flatMap<SQLNode>((column, index) => [
        ...(index ? [{ kind: "text", value: ", " } as const] : []),
        { kind: "identifier", path: [column] } as const,
      ]),
      { kind: "text", value: ") VALUES " },
    ];
    rows.forEach((row, rowIndex) => {
      if (rowIndex) valueNodes.push({ kind: "text", value: ", " });
      valueNodes.push({ kind: "text", value: "(" });
      columns.forEach((column, columnIndex) => {
        if (columnIndex) valueNodes.push({ kind: "text", value: ", " });
        valueNodes.push({ kind: "value", value: row[column] });
      });
      valueNodes.push({ kind: "text", value: ")" });
    });
    return new SQLFragment(valueNodes);
  };
  tag.unsafe = (text) => new SQLFragment([{ kind: "unsafe", value: text }]);
  tag.execute = async <Result>(fragment: SQLFragment<Result>) => {
    if (executor) return executor(fragment) as Promise<QueryResult<Result>>;
    const orm = currentORM();
    if (!orm) throw new ScopeError("sql.execute() requires an active ORM.run() scope.");
    return orm.executeFragment(fragment);
  };
  tag.transaction = async (callback) => {
    const orm = currentORM();
    if (!orm) throw new ScopeError("sql.transaction() requires an active ORM.run() scope.");
    return orm.transaction(callback);
  };
  tag.reserve = async (callback) => {
    const orm = currentORM();
    if (!orm) throw new ScopeError("sql.reserve() requires an active ORM.run() scope.");
    return orm.reserve(callback);
  };
  tag.close = async () => {
    const orm = currentORM();
    if (!orm) throw new ScopeError("sql.close() requires an active ORM.run() scope.");
    return orm.close();
  };
  return tag;
}

export const sql = makeTag();
export const createSQLTag = makeTag;
