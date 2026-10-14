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
