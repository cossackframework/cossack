import "reflect-metadata";
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it } from "vitest";
import {
  BaseEntity,
  Column,
  Entity,
  PrimaryGeneratedColumn,
  ScopeError,
  createORM,
  sql,
} from "../src/index.js";
import { createAsyncLocalScope, MemoryDriver } from "../src/adapter/index.js";

@Entity()
class ScopedUser extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column("varchar")
  declare name: string;
}

describe("ORM scopes", () => {
  it("throws actionable errors outside a run scope", () => {
    expect(() => ScopedUser.create({ name: "Ada" })).toThrow(ScopeError);
  });

  it("binds Active Record and global sql to the current async request", async () => {
    const first = new MemoryDriver("sqlite", (query) => ({
      rows: [{ source: query.parameters[0] }],
    }));
    const second = new MemoryDriver("sqlite", (query) => ({
      rows: [{ source: query.parameters[0] }],
    }));
    const ormA = createORM({
      adapter: { driver: first, scope: createAsyncLocalScope(new AsyncLocalStorage()) },
      entities: [ScopedUser],
    });
    const ormB = createORM({
      adapter: { driver: second, scope: createAsyncLocalScope(new AsyncLocalStorage()) },
      entities: [ScopedUser],
    });
    const [a, b] = await Promise.all([
      ormA.run(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        const result = await sql`SELECT ${"a"} AS source`;
        ScopedUser.create({ name: "A" });
        return result.rows[0]?.source;
      }),
      ormB.run(async () => {
        const result = await sql`SELECT ${"b"} AS source`;
        ScopedUser.create({ name: "B" });
        return result.rows[0]?.source;
      }),
    ]);
    expect([a, b]).toEqual(["a", "b"]);
    expect(first.statements[0]?.query.parameters).toEqual(["a"]);
    expect(second.statements[0]?.query.parameters).toEqual(["b"]);
    await Promise.all([ormA.close(), ormB.close()]);
  });

  it("uses savepoints for nested transactions", async () => {
    const driver = new MemoryDriver();
    const orm = createORM({
      adapter: { driver, scope: createAsyncLocalScope(new AsyncLocalStorage()) },
      entities: [ScopedUser],
    });
    await orm.run(() => orm.transaction(async () => {
      await orm.transaction(async () => {
        await sql`SELECT ${1}`;
      });
    }));
    expect(driver.statements.map((item) => item.query.text)).toContain("SAVEPOINT cossack_sp_2");
    expect(driver.statements.map((item) => item.query.text)).toContain("RELEASE SAVEPOINT cossack_sp_2");
    await orm.close();
  });
});
