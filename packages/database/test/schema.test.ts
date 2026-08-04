import { describe, expect, it } from "vitest";
import {
  DestructiveSchemaChangeError,
  diffSchemas,
  reverseSchemaOperations,
  type OrmSchema,
} from "../src/index.js";
import { introspectPostgres, introspectSQLite } from "../src/schema/introspection.js";

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

  it("treats SQLite text-affinity JSON and datetime declarations as storage-compatible", () => {
    const textColumn = (({ length: _length, ...column }) => column)(
      base.entities[0]!.columns[1]!,
    );
    const existing: OrmSchema = {
      ...base,
      entities: [{
        ...base.entities[0]!,
        columns: [{
          ...textColumn,
          propertyName: "meta",
          columnName: "meta",
          logicalType: "text",
        }, {
          ...textColumn,
          propertyName: "created_at",
          columnName: "created_at",
          logicalType: "varchar",
          length: 32,
        }],
      }],
    };
    const desired: OrmSchema = {
      ...existing,
      entities: [{
        ...existing.entities[0]!,
        columns: [{
          ...textColumn,
          propertyName: "meta",
          columnName: "meta",
          logicalType: "json",
        }, {
          ...textColumn,
          propertyName: "created_at",
          columnName: "created_at",
          logicalType: "datetime",
        }],
      }],
    };
    expect(diffSchemas(existing, desired).empty).toBe(true);
  });

  it("guards destructive changes", () => {
    const desired: OrmSchema = {
      ...base,
      entities: [{ ...base.entities[0]!, columns: [base.entities[0]!.columns[0]!] }],
    };
    expect(() => diffSchemas(base, desired)).toThrow(DestructiveSchemaChangeError);
    expect(diffSchemas(base, desired, { allowDestructive: true }).destructive).toHaveLength(1);
  });

  it("treats nullable-to-required changes as destructive", () => {
    const existing: OrmSchema = {
      ...base,
      entities: [{
        ...base.entities[0]!,
        columns: base.entities[0]!.columns.map((column) =>
          column.columnName === "name" ? { ...column, nullable: true } : column),
      }],
    };
    expect(() => diffSchemas(existing, base)).toThrow(DestructiveSchemaChangeError);
    expect(diffSchemas(existing, base, { allowDestructive: true }).destructive).toHaveLength(1);
  });

  it("reverses generated schema operations in reverse order", () => {
    const desired: OrmSchema = {
      ...base,
      entities: [{
        ...base.entities[0]!,
        columns: [...base.entities[0]!.columns, {
          ...base.entities[0]!.columns[1]!,
          propertyName: "email",
          columnName: "email",
          unique: true,
        }],
      }],
    };
    const forward = diffSchemas(base, desired).operations;
    expect(forward.map((operation) => operation.kind)).toEqual(["add-column"]);
    expect(reverseSchemaOperations(forward, base)).toEqual([{
      kind: "drop-column",
      tableName: "users",
      columnName: "email",
    }]);
  });
});

describe("PostgreSQL introspection", () => {
  it("preserves supported PostgreSQL column and index semantics", async () => {
    const schema = await introspectPostgres(async (text) => {
      if (text.includes("FROM pg_catalog.pg_attribute")) {
        return { rows: [
          {
            table_name: "places",
            column_name: "id",
            data_type: "integer",
            not_null: true,
            column_default: "nextval('places_id_seq'::regclass)",
            identity_kind: "",
            generated_kind: "",
            is_primary: true,
            is_unique: false,
          },
          {
            table_name: "places",
            column_name: "regionID",
            data_type: "character varying(64)",
            not_null: true,
            column_default: null,
            identity_kind: "",
            generated_kind: "",
            is_primary: false,
            is_unique: false,
          },
          {
            table_name: "places",
            column_name: "metadata",
            data_type: "jsonb",
            not_null: false,
            column_default: null,
            identity_kind: "",
            generated_kind: "",
            is_primary: false,
            is_unique: false,
          },
          {
            table_name: "places",
            column_name: "created_at",
            data_type: "timestamp with time zone",
            not_null: true,
            column_default: "now()",
            identity_kind: "",
            generated_kind: "",
            is_primary: false,
            is_unique: false,
          },
          {
            table_name: "places",
            column_name: "location",
            data_type: "geometry(Point,4326)",
            not_null: true,
            column_default: null,
            identity_kind: "",
            generated_kind: "",
            is_primary: false,
            is_unique: false,
          },
        ] } as any;
      }
      if (text.includes("FROM pg_catalog.pg_index")) {
        return { rows: [{
          table_name: "places",
          index_name: "places_region_idx",
          is_unique: false,
          is_primary: false,
          access_method: "btree",
          constraint_type: null,
          is_expression: false,
          is_partial: false,
          definition: "CREATE INDEX places_region_idx ON public.places USING btree (\"regionID\")",
          index_columns: ['"regionID"'],
        }] } as any;
      }
      return { rows: [] } as any;
    });

    expect(schema.entities[0]?.columns).toMatchObject([
      { columnName: "id", logicalType: "integer", generated: "increment", primary: true },
      { columnName: "regionID", logicalType: "varchar", length: 64 },
      { columnName: "metadata", logicalType: "json" },
      { columnName: "created_at", logicalType: "datetime", default: "now()" },
      { columnName: "location", logicalType: "custom:geometry(Point,4326)" },
    ]);
    expect(schema.entities[0]?.indexes).toEqual([{
      name: "places_region_idx",
      columns: ["regionID"],
      unique: false,
    }]);
  });

  it("refuses unsupported PostGIS, operator-class, expression, and constraint objects", async () => {
    await expect(introspectPostgres(async (text) => {
      if (text.includes("FROM pg_catalog.pg_attribute")) {
        return { rows: [{
          table_name: "places",
          column_name: "location",
          data_type: "geometry(Point,4326)",
          not_null: true,
          column_default: null,
          identity_kind: "",
          generated_kind: "",
          is_primary: false,
          is_unique: false,
        }] } as any;
      }
      if (text.includes("FROM pg_catalog.pg_index")) {
        return { rows: [
          {
            table_name: "places",
            index_name: "places_location_gist",
            is_unique: false,
            is_primary: false,
            access_method: "gist",
            constraint_type: null,
            is_expression: false,
            is_partial: false,
            definition: "CREATE INDEX places_location_gist ON public.places USING gist (location)",
            index_columns: ["location"],
          },
          {
            table_name: "places",
            index_name: "places_name_trgm",
            is_unique: false,
            is_primary: false,
            access_method: "gin",
            constraint_type: null,
            is_expression: false,
            is_partial: false,
            definition: "CREATE INDEX places_name_trgm ON public.places USING gin (name gin_trgm_ops)",
            index_columns: ["name gin_trgm_ops"],
          },
          {
            table_name: "places",
            index_name: "places_metadata_kind",
            is_unique: false,
            is_primary: false,
            access_method: "btree",
            constraint_type: null,
            is_expression: true,
            is_partial: false,
            definition: "CREATE INDEX places_metadata_kind ON public.places USING btree ((metadata ->> 'kind'))",
            index_columns: ["(metadata ->> 'kind'::text)"],
          },
        ] } as any;
      }
      return { rows: [{
        table_name: "places",
        constraint_name: "places_metadata_object",
        constraint_type: "c",
        definition: "CHECK (jsonb_typeof(metadata) = 'object'::text)",
      }] } as any;
    })).rejects.toThrow(/places_location_gist.*places_name_trgm.*places_metadata_kind.*places_metadata_object.*were stopped/);
  });
});
