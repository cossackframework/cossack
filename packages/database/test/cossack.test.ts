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

  it("defers owned ORM cleanup only when a response lifetime retains it", async () => {
    const orm = memoryORM();
    const close = vi.spyOn(orm, "close");
    const callbacks: Array<() => Promise<void>> = [];
    await ormMiddleware(() => orm)({
      get: key => key === "cossack:response-lifetime" ? {
        deferCleanup: (cleanup: () => Promise<void>) => { callbacks.push(cleanup); return true; },
      } : undefined,
    }, async () => {});
    expect(close).not.toHaveBeenCalled();
    await callbacks[0]!();
    expect(close).toHaveBeenCalledOnce();
    const ordinary = memoryORM();
    const closeOrdinary = vi.spyOn(ordinary, "close");
    await ormMiddleware(() => ordinary)({ get: () => ({ deferCleanup: () => false }) }, async () => {});
    expect(closeOrdinary).toHaveBeenCalledOnce();
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
        expect(await sessions.has(id)).toBe(true);
        expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
        await sessions.set(id, "cart", { items: [1, 2] });
        expect(await sessions.get(id, "cart")).toEqual({ items: [1, 2] });
        await sessions.bindUser(id, "user-1");
        await sessions.unset(id, "cart");
        expect(await sessions.get(id, "cart")).toBeUndefined();
        await sessions.destroy(id);
        expect(await sessions.getAll(id)).toEqual({});
        expect(await sessions.has(id)).toBe(false);
        const expired = await sessions.create(-1000);
        for (const invalid of [id, expired, 'attacker-chosen']) {
          await sessions.set(invalid, 'cart', 'must not resurrect');
          expect(await sessions.has(invalid)).toBe(false);
          expect(await sessions.getAll(invalid)).toEqual({});
        }
      });
    } finally {
      await orm.close();
    }
  });

  it("uses millisecond cache expiry and validates batches before writes in real SQLite", async () => {
    const orm = createORM({ adapter: await nodeSQLite(), entities: [] });
    const clock = vi.spyOn(Date, "now").mockReturnValue(2_000_000);
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
        const cache = createDatabaseCacheStore();
        await cache.set("key", null, 1001);
        clock.mockReturnValue(2_001_000);
        expect(await cache.get("key")).toBeNull();
        expect(await cache.has("key")).toBe(true);
        expect(await cache.getMany(["key", "missing"])).toEqual([null, undefined]);
        clock.mockReturnValue(2_001_001);
        expect(await cache.has("key")).toBe(false);
        await cache.set("kept", "original");
        for (const ttl of [-1, 1.5, NaN, Infinity, null, "1000", 8640000000000000]) {
          await expect(cache.set("kept", "changed", ttl as any)).rejects.toThrow(/ttlMs/);
        }
        expect(await cache.get("kept")).toBe("original");
        await cache.set("zero", 1, 0);
        expect(await cache.has("zero")).toBe(false);
        for (const entry of [{ key: "invalid", value: 2, ttlMs: -1 },
          { key: "legacy", value: 2, ttlSeconds: 1 }, { key: "", value: 1 },
          { key: "oversized", value: "x".repeat(1024 * 1024) }]) {
          await expect(cache.setMany([{ key: "first", value: 1 }, entry] as any)).rejects.toThrow();
          expect(await cache.has("first")).toBe(false);
        }
        const keys = [".", "..", "/", "flush", "🙂"];
        await cache.setMany(keys.map(key => ({ key, value: null })));
        expect(await cache.getMany(keys)).toEqual(keys.map(() => null));
        await cache.deleteMany(keys);
        expect(await cache.getMany(keys)).toEqual(keys.map(() => undefined));
      });
    } finally { clock.mockRestore(); await orm.close(); }
  });

  it("does not let stale cache cleanup delete a fresh database replacement", async () => {
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
        const cache = createDatabaseCacheStore();
        await cache.set("expired", "old", 1);
        await orm.executeFragment(orm.sql.fragment`
          UPDATE ${orm.sql.id("cache_items")} SET ${orm.sql.id("expires_at")} = ${1}
          WHERE ${orm.sql.id("key")} = ${"expired"}
        `, "update");
        const execute = orm.executeFragment.bind(orm);
        let replace = true;
        const spy = vi.spyOn(orm, "executeFragment").mockImplementation(async (fragment, operation) => {
          const result = await execute(fragment, operation);
          if (operation === "select" && replace) { replace = false; await cache.set("expired", "fresh"); }
          return result;
        });
        expect(await cache.get("expired")).toBeUndefined();
        expect(await cache.get("expired")).toBe("fresh");
        spy.mockRestore();
      });
    } finally { await orm.close(); }
  });
});
