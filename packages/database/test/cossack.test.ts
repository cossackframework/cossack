import { describe, expect, it, vi } from "vitest";
import { createORM } from "../src/index.js";
import { MemoryDriver } from "../src/adapter/index.js";
import { nodeSQLite } from "../src/runtime/node.js";
import {
  createDatabaseCacheStore,
  createDatabaseSessionStore,
  ormMiddleware,
} from "../src/cossack/index.js";

function memoryORM(driver = new MemoryDriver()) {
  return createORM({ adapter: { driver }, entities: [] });
}

describe("Cossack integration", () => {
  it("keeps singleton ORM ownership with the caller", async () => {
    const orm = memoryORM();
    const close = vi.spyOn(orm, "close");
    const context = { set: vi.fn() };
    await ormMiddleware(orm)(context, async () => {
      expect(context.set).toHaveBeenCalledWith("orm", orm);
    });
    expect(close).not.toHaveBeenCalled();
    await orm.close();
  });

  it("closes request-factory ORM instances after downstream failures", async () => {
    const instances: ReturnType<typeof memoryORM>[] = [];
    const middleware = ormMiddleware(async () => {
      const orm = memoryORM();
      instances.push(orm);
      return orm;
    });
    await expect(middleware({}, async () => {
      throw new Error("downstream");
    })).rejects.toThrow("downstream");
    expect(instances).toHaveLength(1);
    expect(() => instances[0]!.run(() => undefined)).toThrow(/closed/i);
  });

  it("provides complete lazy cache and session store contracts", async () => {
    const orm = createORM({ adapter: await nodeSQLite(), entities: [] });
    try {
      await orm.run(async () => {
        await orm.executeFragment(orm.sql.fragment`
          CREATE TABLE ${orm.sql.id("cache_items")} (
            ${orm.sql.id("key")} TEXT PRIMARY KEY,
            ${orm.sql.id("value")} TEXT NOT NULL,
            ${orm.sql.id("expires_at")} INTEGER,
            ${orm.sql.id("updated_at")} INTEGER NOT NULL
          )
        `, "ddl");
        await orm.executeFragment(orm.sql.fragment`
          CREATE TABLE ${orm.sql.id("sessions")} (
            ${orm.sql.id("id")} TEXT PRIMARY KEY,
            ${orm.sql.id("user_id")} TEXT,
            ${orm.sql.id("data")} TEXT,
            ${orm.sql.id("expires_at")} TEXT NOT NULL
          )
        `, "ddl");

        const cache = createDatabaseCacheStore();
        expect(await cache.get("missing")).toBeUndefined();
        await cache.setMany<unknown>([
          { key: "one", value: { count: 1 } },
          { key: "two", value: 2 },
        ]);
        expect(await cache.getMany(["one", "missing", "two"])).toEqual([
          { count: 1 },
          undefined,
          2,
        ]);
        expect(await cache.has("one")).toBe(true);
        await cache.deleteMany(["one", "two"]);
        expect(await cache.has("one")).toBe(false);

        await orm.executeFragment(orm.sql.fragment`
          INSERT INTO ${orm.sql.id("cache_items")}
            (${orm.sql.id("key")}, ${orm.sql.id("value")}, ${orm.sql.id("expires_at")}, ${orm.sql.id("updated_at")})
          VALUES (${"corrupt"}, ${"{"}, ${null}, ${Date.now()})
        `, "insert");
        expect(await cache.get("corrupt")).toBeUndefined();

        const sessions = createDatabaseSessionStore();
        const id = await sessions.create();
        expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
        await sessions.set(id, "cart", { items: [1, 2] });
        expect(await sessions.get(id, "cart")).toEqual({ items: [1, 2] });
        await sessions.bindUser(id, "user-1");
        await sessions.unset(id, "cart");
        expect(await sessions.get(id, "cart")).toBeUndefined();
        await sessions.destroy(id);
        expect(await sessions.getAll(id)).toEqual({});
      });
    } finally {
      await orm.close();
    }
  });
});
