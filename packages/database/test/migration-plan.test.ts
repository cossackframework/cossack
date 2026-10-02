import { describe, expect, it } from "vitest";
import "reflect-metadata";
import { AsyncLocalStorage } from "node:async_hooks";
import { BaseEntity, Entity, PrimaryGeneratedColumn, sql } from "../src/index.js";
import { createAsyncLocalScope } from "../src/adapter/scope.js";
import { defaultNamingStrategy } from "../src/metadata/naming.js";
import { createORM } from "../src/orm.js";
import { MemoryDriver } from "../src/adapter/memory.js";
import { MigrationRunner } from "../src/migration/runner.js";

@Entity()
class PlanEntity extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;
}

describe("migration planning", () => {
  it("renders queued SQL and destructive operations without writing to the database", async () => {
    const driver = new MemoryDriver();
    const orm = createORM({ adapter: { driver }, entities: [] });
    const runner = new MigrationRunner(orm, [{ name: "001_test",
      up({ schema, orm }) {
        schema.raw(orm.sql.fragment`CREATE TABLE example (id integer DEFAULT ${42})`);
        schema.dropTable("obsolete");
      }, down() {},
    }]);
    const plan = await orm.run(() => runner.plan());
    expect(plan).toMatchObject([{ name: "001_test", complete: true, statements: [
      { parameterCount: 1, risk: "safe" },
      { text: 'DROP TABLE "obsolete"', parameterCount: 0, risk: "destructive" },
    ] }]);
    expect(JSON.stringify(plan)).not.toContain('"parameters"');
    expect(driver.statements.every(statement => statement.operation === "select")).toBe(true);
    await orm.close();
  });

  it("blocks direct database work and marks the plan incomplete", async () => {
    const driver = new MemoryDriver();
    const orm = createORM({ adapter: { driver }, entities: [] });
    const runner = new MigrationRunner(orm, [{ name: "001_data",
      async up({ orm }) { await orm.executeFragment(orm.sql.fragment`DELETE FROM users`, "delete"); },
      down() {},
    }]);
    expect(await orm.run(() => runner.plan())).toMatchObject([
      { complete: false, reason: expect.stringContaining("cannot be fully previewed"), statements: [] },
    ]);
    expect(driver.statements.every(statement => statement.operation === "select")).toBe(true);
    await orm.close();
  });

  it.each(["fallback", "async-local"])("blocks implicit/captured writes in a %s scope and restores live queries", async scope => {
    const driver = new MemoryDriver();
    const orm = createORM({ adapter: { driver,
      ...(scope === "async-local" ? { scope: createAsyncLocalScope(new AsyncLocalStorage()) } : {}) }, entities: [PlanEntity] });
    try {
      await orm.run(async () => {
        const attempts = [
          async () => { await PlanEntity.delete({ id: 1 }); },
          async () => { await sql`DELETE FROM plan_entities`; },
          async () => { await orm.executeFragment(orm.sql.fragment`DELETE FROM plan_entities`, "delete"); },
        ];
        for (const attempt of attempts) {
          const runner = new MigrationRunner(orm, [{ name: "001_write", async up() {
            await Promise.resolve(); await attempt();
          }, down() {} }]);
          expect(await runner.plan()).toMatchObject([{ complete: false, statements: [] }]);
        }
        expect(driver.statements.every(statement => statement.operation === "select")).toBe(true);
        await PlanEntity.delete({ id: 2 });
        expect(driver.statements.at(-1)?.operation).toBe("delete");
        expect(driver.statements.at(-1)?.query.parameters).toContain(2);
      });
    } finally { await orm.close(); }
  });

  it("retains the application's custom naming strategy in planned schema metadata", async () => {
    const orm = createORM({ adapter: { driver: new MemoryDriver() }, entities: [PlanEntity],
      namingStrategy: { ...defaultNamingStrategy, tableName: name => `app_${name.toLowerCase()}` } });
    try {
      const runner = new MigrationRunner(orm, [{ name: "001_schema", up({ orm, schema }) {
        schema.createTable(orm.schema().entities[0]!);
      }, down() {} }]);
      expect(await orm.run(() => runner.plan())).toMatchObject([{ complete: true,
        statements: [{ text: expect.stringContaining('CREATE TABLE "app_planentity"') }] }]);
    } finally { await orm.close(); }
  });

  it("reads missing migration history without creating the bookkeeping table", async () => {
    const driver = new MemoryDriver();
    const orm = createORM({ adapter: { driver }, entities: [] });
    const runner = new MigrationRunner(orm, []);
    expect(await orm.run(() => runner.status({ readOnly: true }))).toEqual([]);
    expect(driver.statements).toMatchObject([{ operation: "select", query: {
      text: 'PRAGMA table_info("_cossack_migrations")', parameters: [],
    } }]);
    await orm.close();
  });

  it.each(["postgres", "mysql"] as const)("reads %s history through a bound catalog query", async dialect => {
    const driver = new MemoryDriver(dialect, query => query.text.includes("information_schema.tables")
      ? { rows: [{ table_name: "custom_history" }] }
      : { rows: [{ name: "001_applied", checksum: "checksum", batch: 2, applied_at: "2026-01-01T00:00:00Z" }] });
    const orm = createORM({ adapter: { driver }, entities: [] });
    const runner = new MigrationRunner(orm, [], "custom_history");
    expect(await orm.run(() => runner.applied({ readOnly: true }))).toMatchObject([{ name: "001_applied", batch: 2 }]);
    expect(driver.statements[0]?.query.parameters).toEqual(["custom_history"]);
    expect(driver.statements.every(statement => statement.operation === "select")).toBe(true);
    await orm.close();
  });
});
