import "reflect-metadata";
import { describe, expect, it } from "vitest";
import {
  BaseEntity,
  Column,
  ConfigurationError,
  Entity,
  MoreThan,
  PrimaryGeneratedColumn,
  SchemaBuilder,
  compileSQL,
  createORM,
  sql,
} from "../src/index.js";
import { MemoryDriver } from "../src/adapter/memory.js";
import { dialectFor } from "../src/dialect/dialects.js";
import { nodeSQLite } from "../src/runtime/node.js";

@Entity({ tableName: "widgets" })
class Widget extends BaseEntity {
  @PrimaryGeneratedColumn() declare id: number;
  @Column({ type: "varchar", nullable: true }) declare name: string | null;
}

function memoryORM(dialect: "sqlite" | "postgres" | "mysql") {
  const driver = new MemoryDriver(dialect);
  return { driver, orm: createORM({ adapter: { driver }, entities: [Widget] }) };
}

describe("insert without values", () => {
  it("emits DEFAULT VALUES on SQLite and PostgreSQL and () VALUES () on MySQL", async () => {
    for (const [dialect, expected] of [
      ["sqlite", 'INSERT INTO "widgets" DEFAULT VALUES'],
      ["postgres", 'INSERT INTO "widgets" DEFAULT VALUES'],
      ["mysql", "INSERT INTO `widgets` () VALUES ()"],
    ] as const) {
      const { driver, orm } = memoryORM(dialect);
      await orm.run(() => Widget.insert({}));
      expect(driver.statements.at(-1)?.query.text).toBe(expected);
      await orm.close();
    }
    const { driver, orm } = memoryORM("postgres");
    await orm.run(() => Widget.insert([{}, {}]));
    expect(driver.statements.map((statement) => statement.query.text)).toEqual([
      'INSERT INTO "widgets" DEFAULT VALUES',
      'INSERT INTO "widgets" DEFAULT VALUES',
    ]);
    await orm.close();
  });

  it("saves an entity with only generated columns on SQLite", async () => {
    const orm = createORM({ adapter: await nodeSQLite(), entities: [Widget] });
    try {
      await orm.run(async () => {
        await new SchemaBuilder().createTable(orm.schema().entities[0]!).execute(orm);
        const widget = await Widget.create().save();
        expect(widget.id).toBe(1);
        expect(widget.name).toBeNull();
      });
    } finally {
      await orm.close();
    }
  });
});

describe("predicate footguns", () => {
  it("rejects undefined predicate values instead of comparing with NULL", async () => {
    const { driver, orm } = memoryORM("postgres");
    await orm.run(async () => {
      await expect(Widget.find({ where: { name: undefined } as never })).rejects.toThrow(/Widget\.name.*undefined/);
      await expect(Widget.find({ where: { name: MoreThan(undefined) } as never })).rejects.toThrow(/undefined/);
      await expect(Widget.find({ where: { name: null } })).resolves.toEqual([]);
    });
    expect(driver.statements.map((statement) => statement.query.text)).toEqual([
      'SELECT "widgets"."id", "widgets"."name" FROM "widgets" AS "widgets" WHERE ("widgets"."name" IS NULL)',
    ]);
    await orm.close();
  });

  it("requires deleteAll()/updateAll() to affect every row", async () => {
    const { driver, orm } = memoryORM("postgres");
    await orm.run(async () => {
      await expect(Widget.delete({})).rejects.toThrow(ConfigurationError);
      await expect(Widget.delete([{}])).rejects.toThrow(/deleteAll/);
      await expect(Widget.update({}, { name: "x" })).rejects.toThrow(/updateAll/);
      expect(driver.statements).toEqual([]);
      await Widget.deleteAll();
      await Widget.updateAll({ name: "x" });
      await Widget.delete({ id: 1 });
    });
    expect(driver.statements.map((statement) => statement.query.text)).toEqual([
      'DELETE FROM "widgets"',
      'UPDATE "widgets" SET "name" = $1',
      'DELETE FROM "widgets" WHERE ("id" = $1)',
    ]);
    await orm.close();
  });
});

describe("raw SQL empty lists", () => {
  it("rejects empty array interpolation and empty sql.join()", () => {
    expect(() => sql.fragment`SELECT 1 WHERE id IN (${[]})`).toThrow(/empty array/);
    expect(() => sql.join([])).toThrow(/empty/);
    expect(compileSQL(sql.fragment`id IN (${[1, 2]})`, dialectFor("postgres")).text).toBe("id IN ($1, $2)");
  });
});

describe("pagination literals", () => {
  // mysql2 sends JavaScript numbers as DOUBLE parameters, and MySQL 8.0.22+
  // rejects a DOUBLE LIMIT in a prepared statement (ER_WRONG_ARGUMENTS), which
  // broke every findOne() on MySQL. LIMIT and OFFSET are validated integers.
  it.each(["sqlite", "postgres", "mysql"] as const)("renders LIMIT and OFFSET as integer literals on %s", async (dialect) => {
    const { driver, orm } = memoryORM(dialect);
    await orm.run(async () => {
      await Widget.findOne({ where: { name: "a" } });
      await Widget.find({ take: 10, skip: 20 });
    });
    const [single, page] = driver.statements.map((statement) => statement.query);
    expect(single?.text).toMatch(/ LIMIT 1$/);
    expect(single?.parameters).toEqual(["a"]);
    expect(page?.text).toMatch(/ LIMIT 10 OFFSET 20$/);
    expect(page?.parameters).toEqual([]);
    await orm.close();
  });

  it("rejects non-integer pagination before building SQL", async () => {
    const { orm } = memoryORM("mysql");
    orm.run(() => {
      expect(() => Widget.query().limit(1.5)).toThrow(ConfigurationError);
      expect(() => Widget.query().offset(-1)).toThrow(ConfigurationError);
      expect(() => Widget.query().limit("1 OR 1=1" as never)).toThrow(ConfigurationError);
    });
    await orm.close();
  });
});
