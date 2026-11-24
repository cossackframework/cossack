import "reflect-metadata";
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it, vi } from "vitest";
import type { ORM } from "../src/orm.js";
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
  it("shares the active ORM registry across duplicated module graphs", async () => {
    vi.resetModules();
    const first = await import("../src/scope.js");
    const scoped = {} as ORM;
    const orm = {
      isCurrentScope: () => true,
      currentScopedORM: () => scoped,
    } as ORM;
    first.registerORM(orm);

    vi.resetModules();
    const second = await import("../src/scope.js");
    try {
      expect(second.currentORM()).toBe(scoped);
    } finally {
      second.unregisterORM(orm);
    }
  });

  it("numbers scopes across duplicated module graphs, so the inner ORM of another copy wins", async () => {
    vi.resetModules();
    const outerCopy = await import("../src/index.js");
    const outerAdapter = await import("../src/adapter/index.js");
    const outerScope = await import("../src/scope.js");
    vi.resetModules();
    const innerCopy = await import("../src/index.js");
    const innerAdapter = await import("../src/adapter/index.js");
    const innerScope = await import("../src/scope.js");
    expect(innerCopy.createORM).not.toBe(outerCopy.createORM);
    const main = outerCopy.createORM({
      adapter: { driver: new outerAdapter.MemoryDriver("sqlite"), scope: outerAdapter.createAsyncLocalScope(new AsyncLocalStorage()) },
      entities: [],
    });
    const tenant = innerCopy.createORM({
      adapter: { driver: new innerAdapter.MemoryDriver("sqlite"), scope: innerAdapter.createAsyncLocalScope(new AsyncLocalStorage()) },
      entities: [],
    });
    try {
      // Each copy's first scope: counted apart, both would be scope 1 and the outer ORM would stay current.
      main.run(() => tenant.run(() => {
        expect(outerScope.currentORM()).toBe(tenant);
        expect(innerScope.currentORM()).toBe(tenant);
      }));
      tenant.run(() => main.run(() => expect(innerScope.currentORM()).toBe(main)));
    } finally {
      await main.close();
      await tenant.close();
    }
  });

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

describe("several ORMs", () => {
  it("resolves the innermost scope, whichever ORM was created first", async () => {
    const { createORM } = await import("../src/index.js");
    const { currentORM } = await import("../src/scope.js");
    const { nodeSQLite } = await import("../src/runtime/node.js");
    const first = createORM({ adapter: await nodeSQLite(), entities: [] });
    const second = createORM({ adapter: await nodeSQLite(), entities: [] });
    try {
      await first.run(async () => {
        expect(currentORM()).toBe(first);
        await second.run(async () => {
          expect(currentORM()).toBe(second);
          // Back to the outer ORM in front of the inner one, as account code does inside a tenant's scope.
          await first.run(async () => { expect(currentORM()).toBe(first); });
          expect(currentORM()).toBe(second);
        });
        expect(currentORM()).toBe(first);
      });
      await second.run(async () => {
        await first.run(async () => { expect(currentORM()).toBe(first); });
        expect(currentORM()).toBe(second);
      });
      expect(currentORM()).toBeUndefined();
    } finally { await first.close(); await second.close(); }
  });
});
