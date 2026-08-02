import { describe, expect, it } from "vitest";
import {
  DestructiveSchemaChangeError,
  diffSchemas,
  type OrmSchema,
} from "../src/index.js";
import { introspectSQLite } from "../src/schema/introspection.js";

const base: OrmSchema = {
  version: 1,
  dialect: "sqlite",
  entities: [{
    modelName: "User",
    tableName: "users",
    columns: [{
      propertyName: "id",
      columnName: "id",
      logicalType: "integer",
      nullable: false,
      primary: true,
      generated: "increment",
      unique: false,
      insert: true,
      update: true,
      select: true,
    }, {
      propertyName: "name",
      columnName: "name",
      logicalType: "varchar",
      nullable: false,
      primary: false,
      generated: false,
      unique: false,
      length: 255,
      insert: true,
      update: true,
      select: true,
    }],
    relations: [],
    indexes: [],
    virtual: false,
  }],
};

describe("schema diff", () => {
  it("normalizes SQLite literal defaults for drift comparisons", async () => {
    const schema = await introspectSQLite(async (text) => {
      if (text.startsWith("SELECT name FROM sqlite_master")) {
        return { rows: [{ name: "sessions" }] } as any;
      }
      if (text.startsWith("PRAGMA table_info")) {
        return {
          rows: [
            { name: "created_at", type: "VARCHAR(32)", notnull: 1, dflt_value: "''", pk: 0 },
            { name: "attempts", type: "INTEGER", notnull: 1, dflt_value: "0", pk: 0 },
            { name: "id", type: "VARCHAR(191)", notnull: 0, dflt_value: null, pk: 1 },
          ],
        } as any;
      }
      if (text.startsWith("PRAGMA index_list")) {
        return {
          rows: [{ name: "sqlite_autoindex_sessions_1", unique: 1, origin: "pk" }],
        } as any;
      }
      if (text.startsWith("PRAGMA index_info")) {
        return { rows: [{ name: "id" }] } as any;
      }
      return { rows: [] } as any;
    });

    expect(schema.entities[0]?.columns.map((column) => column.default)).toEqual(["", 0, undefined]);
    expect(schema.entities[0]?.columns[2]?.nullable).toBe(false);
    expect(schema.entities[0]?.columns[2]?.unique).toBe(false);
  });

  it("uses explicit renamedFrom rather than guessing", () => {
    const desired: OrmSchema = {
      ...base,
      entities: [{
        ...base.entities[0]!,
        tableName: "people",
        renamedFrom: "users",
        columns: base.entities[0]!.columns.map((column) =>
          column.columnName === "name"
            ? { ...column, columnName: "display_name", renamedFrom: "name" }
            : column),
      }],
    };
    const diff = diffSchemas(base, desired);
    expect(diff.operations.map((operation) => operation.kind)).toEqual([
      "rename-table",
      "rename-column",
    ]);
  });

  it("guards destructive changes", () => {
    const desired: OrmSchema = {
      ...base,
      entities: [{ ...base.entities[0]!, columns: [base.entities[0]!.columns[0]!] }],
    };
    expect(() => diffSchemas(base, desired)).toThrow(DestructiveSchemaChangeError);
    expect(diffSchemas(base, desired, { allowDestructive: true }).destructive).toHaveLength(1);
  });
});
