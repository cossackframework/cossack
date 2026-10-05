import { describe, expect, it } from "vitest";
import { compileSQL, sql, SQL as PortableSQL, SQLFragment } from "../src/index.js";
import { SQL, nodeSQLite } from "../src/runtime/node.js";
import { mysqlDialect, postgresDialect, sqliteDialect } from "../src/dialect/dialects.js";

describe("SQL fragments", () => {
  it("parameterizes interpolated values and preserves injection as data", () => {
    const attack = "'; DROP TABLE users; --";
    const fragment = sql.fragment`SELECT * FROM ${sql.id("users")} WHERE ${sql.id("email")} = ${attack}`;
    const compiled = compileSQL(fragment, postgresDialect);
    expect(compiled.text).toBe('SELECT * FROM "users" WHERE "email" = $1');
    expect(compiled.parameters).toEqual([attack]);
    expect(compiled.text).not.toContain("DROP TABLE");
  });

  it("quotes identifier paths for every dialect", () => {
    const fragment = sql.fragment`SELECT ${sql.id('odd"name', "value")} FROM ${sql.id("table")}`;
    expect(compileSQL(fragment, sqliteDialect).text).toBe(
      'SELECT "odd""name"."value" FROM "table"',
    );
    expect(compileSQL(fragment, mysqlDialect).text).toBe(
      "SELECT `odd\"name`.`value` FROM `table`",
    );
  });

  it("renumbers nested PostgreSQL fragments", () => {
    const left = sql.fragment`${1} + ${2}`;
    const right = sql.fragment`${3}`;
    const compiled = compileSQL(sql.fragment`SELECT ${left}, ${right}`, postgresDialect);
    expect(compiled.text).toBe("SELECT $1 + $2, $3");
    expect(compiled.parameters).toEqual([1, 2, 3]);
  });

  it("builds deterministic object and bulk values", () => {
    const fragment = sql.values([{ name: "Ada", active: true }, { name: "Grace", active: false }]);
    const compiled = compileSQL(fragment, sqliteDialect);
    expect(compiled.text).toBe('("name", "active") VALUES (?, ?), (?, ?)');
    expect(compiled.parameters).toEqual(["Ada", true, "Grace", false]);
  });

  it("requires unsafe SQL to be explicit", () => {
    const unsafe = sql.unsafe("CURRENT_TIMESTAMP");
    expect(unsafe).toBeInstanceOf(SQLFragment);
    expect(compileSQL(unsafe, sqliteDialect)).toEqual({
      text: "CURRENT_TIMESTAMP",
      parameters: [],
    });
  });

  it("auto-selects Node SQLite for the Bun-compatible SQL client", async () => {
    const client = new SQL(":memory:");
    await client`CREATE TABLE messages (id integer primary key, body text not null)`;
    await client`INSERT INTO messages (body) VALUES (${"safe"})`;
    const result = await client<{ body: string }>`SELECT body FROM messages`;
    expect(result.rows).toEqual([{ body: "safe" }]);
    await client.close();
  });

  it("uses an injected adapter from the runtime-neutral SQL export", async () => {
    const client = new PortableSQL({ adapter: await nodeSQLite() });
    await client`CREATE TABLE notes (body TEXT NOT NULL)`;
    await client`INSERT INTO notes (body) VALUES (${"portable"})`;
    const result = await client<{ body: string }>`SELECT body FROM notes`;
    expect(result.rows).toEqual([{ body: "portable" }]);
    await client.close();
  });
});
