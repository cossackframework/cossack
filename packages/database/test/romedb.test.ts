import "reflect-metadata";
import { describe, expect, it } from "vitest";
import {
  BaseEntity,
  Column,
  ConfigurationError,
  Entity,
  Index,
  ManyToOne,
  MetadataError,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  RecordLink,
  createORM,
  createTableDDL,
  diffSchemas,
  renderOperation,
  type Relation,
} from "../src/index.js";
import { sqliteDialect } from "../src/dialect/dialects.js";
import {
  introspectRomeDB,
  numberPlaceholders,
  romedb,
  romedbClient,
  type RomeDBBinding,
  type RomeDBStatement,
  type RomeDBStatementResult,
} from "../src/runtime/romedb.js";
import { nodeSQLite } from "../src/runtime/node.js";

// Stand-ins for RomeDB's value classes.
class RecordId { constructor(readonly table: string, readonly key: unknown) {} }
class Float64 { constructor(readonly value: number) {} }
const values = { RecordId, Float64 } as never;

type Call = { kind: "read" | "write"; statements: RomeDBStatement[]; options: unknown };

function fakeBinding(reply: (statement: RomeDBStatement) => RomeDBStatementResult = () => ({ columns: [], rows: [], affected: 0n })) {
  const calls: Call[] = [];
  const run = (kind: Call["kind"]) => async (statements: RomeDBStatement[], options?: unknown) => {
    calls.push({ kind, statements, options });
    return { results: statements.map(reply) };
  };
  const binding: RomeDBBinding = { read: run("read"), write: run("write") };
  return { binding, calls };
}

@Entity({ tableName: "authors", model: "document" })
@Index(["profile.city"])
class Author extends BaseEntity {
  @PrimaryGeneratedColumn("uuid") declare id: string;
  @Column({ type: "varchar", unique: true }) declare handle: string;
  @Column({ type: "boolean" }) declare active: boolean;
  @Column({ type: "json", nullable: true }) declare profile: { city: string } | null;
}

@Entity({ tableName: "books", model: "document" })
class Book extends BaseEntity {
  @PrimaryColumn({ type: "varchar" }) declare id: string;
  @Column({ type: "varchar" }) declare title: string;
  @ManyToOne(() => Author) declare author: Relation<Author>;
  declare authorId: string;
}

@Entity({ tableName: "notes" })
class Note extends BaseEntity {
  @PrimaryColumn({ type: "varchar" }) declare id: string;
  @Column({ type: "boolean" }) declare pinned: boolean;
  @ManyToOne(() => Author) declare author: Relation<Author>;
  declare authorId: string;
}

describe("RomeDB adapter", () => {
  it("numbers positional placeholders and leaves quoted text alone", () => {
    expect(numberPlaceholders(`SELECT "a?" FROM t WHERE b = ? AND c = 'it''s?' AND d IN (?, ?)`))
      .toBe(`SELECT "a?" FROM t WHERE b = $p1 AND c = 'it''s?' AND d IN ($p2, $p3)`);
  });

  it("sends a query as a read and a change as one write", async () => {
    const { binding, calls } = fakeBinding((statement) => /^SELECT/.test(statement.rql)
      ? { columns: ["id", "n", "big", "f"], rows: [["a", 2n, 9007199254740993n, new Float64(1.5)]], affected: 0n }
      : { columns: [], rows: [], affected: 3n });
    const orm = createORM({ adapter: await romedb(binding, { values }), entities: [Note, Author] });
    await orm.run(async () => {
      const read = await orm.sql`SELECT id, n, big, f FROM notes WHERE id = ${"a"}`;
      // Integers that fit are numbers, larger ones stay exact, and a float is a number.
      expect(read.rows).toEqual([{ id: "a", n: 2, big: 9007199254740993n, f: 1.5 }]);
      const written = await Note.update({ id: "a" }, { pinned: true });
      expect(written.meta.rowsAffected).toBe(3);
      await orm.sql`SELECT id FROM notes WHERE note = ${"mentions DELETE"}`;
      await orm.sql`WITH gone AS (SELECT id FROM notes) DELETE FROM notes WHERE id IN (SELECT id FROM gone)`;
    });
    expect(calls.map((call) => call.kind)).toEqual(["read", "write", "read", "write"]);
    expect(calls[0]!.statements).toEqual([{ rql: "SELECT id, n, big, f FROM notes WHERE id = $p1", params: { $p1: "a" } }]);
    // A relational boolean is an integer, as in every SQLite-dialect database.
    expect(calls[1]!.statements).toEqual([{ rql: `UPDATE "notes" SET "pinned" = $p1 WHERE ("id" = $p2)`, params: { $p1: 1, $p2: "a" } }]);
    expect(calls[1]!.options).toEqual({ kind: "orm", retryConflicts: 5 });
  });

  it("declares one atomic batch of 32 statements and no transaction", async () => {
    const { binding } = fakeBinding();
    const orm = createORM({ adapter: await romedb(binding, { values }), entities: [Note, Author] });
    expect(orm.driver.capabilities).toMatchObject({ transactions: false, batch: true, batchLimit: 32, returning: true, documents: true });
    expect(orm.inspectCapabilities().provider).toBe("romedb");
    expect(romedbClient(orm)).toBe(binding);
    expect(() => romedbClient()).toThrow(ConfigurationError);
  });

  it("gives no RomeDB instance for another database", async () => {
    const orm = createORM({ adapter: await nodeSQLite(), entities: [Note, Author].slice(0, 0) });
    expect(() => romedbClient(orm)).toThrow(/RomeDB adapter/);
    await orm.close();
  });

  it("stores a document's fields with their types and its links as records", async () => {
    const { binding, calls } = fakeBinding((statement) => /^SELECT/.test(statement.rql)
      ? { columns: ["id", "title", "author_id"], rows: [[new RecordId("books", "b1"), "T", new RecordId("authors", "a1")]], affected: 0n }
      : { columns: [], rows: [], affected: 1n });
    const orm = createORM({ adapter: await romedb(binding, { values }), entities: [Author, Book] });
    await orm.run(async () => {
      await Author.insert({ id: "a1", handle: "ada", active: true, profile: { city: "London" } });
      await Author.insert({ id: "a2", handle: "bob", active: false, profile: null });
      await Book.insert({ id: "b1", title: "T", authorId: "a1" });
      const [book] = await Book.find({ where: { authorId: "a1" } });
      // The entity holds keys; the tables are in the metadata.
      expect(book).toMatchObject({ id: "b1", title: "T", authorId: "a1" });
      await Author.insert({});
    });
    const [first, second, third, select, empty] = calls.map((call) => call.statements[0]!);
    expect(first!.rql).toBe(`INSERT INTO "authors" ("id", "handle", "active", "profile") VALUES ($p1, $p2, $p3, $p4)`);
    expect(first!.params).toEqual({ $p1: new RecordId("authors", "a1"), $p2: "ada", $p3: true, $p4: { city: "London" } });
    // A field that is not set is left out of the document.
    expect(second!.rql).toBe(`INSERT INTO "authors" ("id", "handle", "active") VALUES ($p1, $p2, $p3)`);
    expect(third!.params).toEqual({ $p1: new RecordId("books", "b1"), $p2: "T", $p3: new RecordId("authors", "a1") });
    expect(select!.params).toEqual({ $p1: new RecordId("authors", "a1") });
    expect(empty).toEqual({ rql: `INSERT INTO "authors" DOCUMENT $p1`, params: { $p1: {} } });
  });

  it("sends a record link from the sql tag as a record, and reads one back", async () => {
    const { binding, calls } = fakeBinding(() => ({ columns: ["doc"], rows: [[{ owner: new RecordId("authors", 7n), tags: ["x"] }]], affected: 0n }));
    const orm = createORM({ adapter: await romedb(binding, { values }), entities: [Author, Book] });
    await orm.run(async () => {
      const result = await orm.sql<{ doc: { owner: RecordLink } }>`SELECT * FROM books WHERE author_id = ${new RecordLink("authors", "a1")}`;
      expect(result.rows[0]!.doc.owner).toBeInstanceOf(RecordLink);
      expect(String(result.rows[0]!.doc.owner)).toBe("authors:7");
    });
    expect(calls[0]!.statements[0]!.params).toEqual({ $p1: new RecordId("authors", "a1") });
  });

  it("needs RomeDB's value classes for document entities", async () => {
    const { binding } = fakeBinding();
    const adapter = await romedb(binding);
    expect(() => createORM({ adapter, entities: [Author, Book] })).toThrow(/document entity Author/);
  });

  it("reads the schema from INFO FOR and the stored DDL", async () => {
    const usersSql = `CREATE TABLE "users" ("id" text PRIMARY KEY NOT NULL, "email" varchar(255) NOT NULL UNIQUE, "team_id" text REFERENCES "teams" ("id") ON DELETE SET NULL, "status" text NOT NULL CHECK ("status" IN ('a', 'b')), CONSTRAINT "users_pair" UNIQUE ("email", "team_id"))`;
    const sessionsSql = `CREATE TABLE "sessions" (\n  "id" text PRIMARY KEY NOT NULL,\n  "user_id" text,\n  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE\n)`;
    const replies: Record<string, unknown> = {
      "INFO FOR DB": [{ info: { tables: [
        { name: "users", model: "relational" }, { name: "sessions", model: "relational" }, { name: "people", model: "document" },
        { name: "_cossack_migrations", model: "relational" }, { name: "__romedb_catalog", model: "relational" },
      ] } }],
      "SELECT type, name, tbl_name, sql FROM sqlite_master": [
        { type: "table", name: "users", tbl_name: "users", sql: usersSql },
        { type: "table", name: "sessions", tbl_name: "sessions", sql: sessionsSql },
        { type: "index", name: "sessions_user", tbl_name: "sessions", sql: `CREATE INDEX "sessions_user" ON "sessions" ("user_id", "id" DESC)` },
        { type: "index", name: "sqlite_autoindex_users_1", tbl_name: "users", sql: null },
      ],
      'INFO FOR TABLE "users"': [{ info: { model: "relational", columns: [
        { name: "id", type: "text", notnull: 1, dflt_value: null, pk: 1 },
        { name: "email", type: "varchar(255)", notnull: 1, dflt_value: null, pk: 0 },
        { name: "team_id", type: "text", notnull: 0, dflt_value: null, pk: 0 },
        { name: "status", type: "text", notnull: 1, dflt_value: null, pk: 0 },
      ], indexes: [{ name: "sqlite_autoindex_users_2", origin: "u", unique: 1 }, { name: "sqlite_autoindex_users_1", origin: "pk", unique: 1 }] } }],
      'INFO FOR TABLE "sessions"': [{ info: { model: "relational", columns: [
        { name: "id", type: "text", notnull: 1, dflt_value: null, pk: 1 },
        { name: "user_id", type: "text", notnull: 0, dflt_value: null, pk: 0 },
      ], indexes: [{ name: "sessions_user", origin: "c", unique: 0 }] } }],
      'INFO FOR TABLE "people"': [{ info: { model: "document", indexes: [
        { name: "people_pair", unique: false, path: ["name"], paths: [["name"], ["profile", "city"]] },
        { name: "people_handle", unique: true, path: ["handle"] },
      ] } }],
    };
    const schema = await introspectRomeDB(async (rql) => replies[rql] as Record<string, unknown>[]);
    expect(schema.entities.map((entity) => entity.tableName)).toEqual(["people", "sessions", "users"]);
    const [people, sessions, users] = schema.entities;
    expect(people).toMatchObject({ model: "document", columns: [], indexes: [
      { name: "people_handle", columns: ["handle"], unique: true },
      { name: "people_pair", columns: ["name", "profile.city"], unique: false },
    ] });
    expect(sessions!.indexes).toEqual([{ name: "sessions_user", columns: ["user_id", "id"], unique: false }]);
    expect(sessions!.relations).toMatchObject([{ joinColumn: "user_id", targetTableName: "users", referencedColumn: "id", onDelete: "CASCADE" }]);
    expect(users!.columns.find((column) => column.columnName === "email")).toMatchObject({ unique: true, length: 255 });
    expect(users!.columns.find((column) => column.columnName === "team_id")!.unique).toBe(false);
    expect(users!.columns.find((column) => column.columnName === "status")).toMatchObject({ logicalType: "enum", enumValues: ["a", "b"] });
    expect(users!.relations).toMatchObject([{ joinColumn: "team_id", targetTableName: "teams", onDelete: "SET NULL" }]);
    expect(users!.indexes).toEqual([]);
  });
});

describe("document entities", () => {
  it("are tables without columns, with their unique fields as indexes", async () => {
    const { binding } = fakeBinding();
    const orm = createORM({ adapter: await romedb(binding, { values }), entities: [Author, Book, Note] });
    const [author, book, note] = orm.schema().entities;
    expect(createTableDDL(author!, sqliteDialect)).toEqual([
      `CREATE TABLE "authors"`,
      `CREATE INDEX "idx_authors_profile.city" ON "authors" ("profile"."city")`,
      `CREATE UNIQUE INDEX "uq_authors_handle" ON "authors" ("handle")`,
    ]);
    expect(createTableDDL(book!, sqliteDialect)).toEqual([`CREATE TABLE "books"`]);
    // A relational table keeps the key of a document, without a foreign key that could not name it.
    expect(createTableDDL(note!, sqliteDialect).join("\n")).not.toContain("FOREIGN KEY");
    expect(book!.columns.find((column) => column.columnName === "author_id")).toMatchObject({ document: true, recordTable: "authors" });
    expect(note!.columns.find((column) => column.columnName === "author_id")!.recordTable).toBeUndefined();
  });

  it("compare by their indexes only", async () => {
    const { binding } = fakeBinding();
    const orm = createORM({ adapter: await romedb(binding, { values }), entities: [Author] });
    const existing = { version: 1 as const, dialect: "sqlite" as const, entities: [{
      modelName: "authors", tableName: "authors", columns: [], relations: [], virtual: false, model: "document" as const,
      indexes: [{ name: "uq_authors_handle", columns: ["handle"], unique: true }, { name: "old", columns: ["x"], unique: false }],
    }] };
    const diff = diffSchemas(existing, orm.schema());
    expect(diff.operations.map((operation) => operation.kind)).toEqual(["create-index", "drop-index"]);
    expect(renderOperation(diff.operations[0]!, sqliteDialect)).toEqual([`CREATE INDEX "idx_authors_profile.city" ON "authors" ("profile"."city")`]);
    const relational = { ...existing, entities: [{ ...existing.entities[0]!, model: undefined as never }] };
    expect(() => diffSchemas(relational, orm.schema())).toThrow(/does not change its model/);
  });

  it("need one primary column stored as id", () => {
    @Entity({ tableName: "bad_keys", model: "document" })
    class BadKey extends BaseEntity {
      @PrimaryColumn({ type: "varchar", name: "key" }) declare key: string;
    }
    @Entity({ tableName: "bad_counters", model: "document" })
    class BadCounter extends BaseEntity {
      @PrimaryGeneratedColumn() declare id: number;
    }
    const { binding } = fakeBinding();
    const adapter = { driver: { dialect: "sqlite", capabilities: { documents: true } } } as never;
    void binding;
    expect(() => createORM({ adapter, entities: [BadKey] })).toThrow(MetadataError);
    expect(() => createORM({ adapter, entities: [BadCounter] })).toThrow(/not a counter/);
  });
});

describe("applyPendingMigrations", () => {
  it("applies what is pending once, and reads only when the database is up to date", async () => {
    const { applyPendingMigrations, sql } = await import("../src/index.js");
    const queries: string[] = [];
    const orm = createORM({ adapter: await nodeSQLite(), entities: [], logger: (event) => { queries.push(event.operation); } });
    const migrations = [{
      name: "001_notes",
      up({ schema }: { schema: { raw(fragment: unknown): unknown } }) { schema.raw(sql.unsafe("CREATE TABLE notes (id integer primary key)")); },
    }] as never;
    expect(await applyPendingMigrations(orm, migrations)).toEqual(["001_notes"]);
    queries.length = 0;
    expect(await applyPendingMigrations(orm, migrations)).toEqual([]);
    // The second start looked at the history and wrote nothing.
    expect(queries.every((operation) => operation === "select")).toBe(true);
    expect((await orm.sql`SELECT name FROM _cossack_migrations`).rows).toEqual([{ name: "001_notes" }]);
    await orm.close();
  });
});

describe("atomic()", () => {
  it("runs statements in one transaction and gives each result", async () => {
    const { atomic, sql } = await import("../src/index.js");
    const orm = createORM({ adapter: await nodeSQLite(), entities: [] });
    await orm.run(async () => {
      await orm.sql`CREATE TABLE counters (id TEXT PRIMARY KEY, n INTEGER NOT NULL)`;
      const count = () => atomic([
        sql.fragment`INSERT INTO counters (id, n) VALUES (${"a"}, 0) ON CONFLICT (id) DO NOTHING`,
        sql.fragment`UPDATE counters SET n = n + 1 WHERE id = ${"a"} AND n < ${2}`,
      ]);
      expect((await count())[1]!.meta.rowsAffected).toBe(1);
      expect((await count())[1]!.meta.rowsAffected).toBe(1);
      expect((await count())[1]!.meta.rowsAffected).toBe(0);
      // A failing statement undoes the ones before it.
      await expect(atomic([sql.fragment`UPDATE counters SET n = 0`, sql.fragment`INSERT INTO missing (id) VALUES (1)`])).rejects.toThrow();
      expect((await orm.sql<{ n: number }>`SELECT n FROM counters`).rows).toEqual([{ n: 2 }]);
    });
    await orm.close();
  });

  it("is one write on RomeDB", async () => {
    const { atomic, sql } = await import("../src/index.js");
    const { binding, calls } = fakeBinding(() => ({ columns: [], rows: [], affected: 1n }));
    const orm = createORM({ adapter: await romedb(binding, { values }), entities: [] });
    await orm.run(async () => {
      const results = await atomic([sql.fragment`DELETE FROM t WHERE id = ${"a"}`, sql.fragment`UPDATE t SET n = n + 1 WHERE id = ${"a"}`]);
      expect(results.map((result) => result.meta.rowsAffected)).toEqual([1, 1]);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: "write", statements: [{ rql: "DELETE FROM t WHERE id = $p1" }, { rql: "UPDATE t SET n = n + 1 WHERE id = $p1" }] });
  });
});
