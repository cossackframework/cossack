import "reflect-metadata";
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it } from "vitest";
import {
  ConfigurationError,
  SeederError,
  SeederRunner,
  UnsupportedCapabilityError,
  createORM,
  defineSeeder,
  sql,
} from "../src/index.js";
import {
  MemoryDriver,
  createAsyncLocalScope,
  type Driver,
} from "../src/adapter/index.js";

class TrackingDriver extends MemoryDriver {
  transactions = 0;

  override async transaction<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    this.transactions++;
    return super.transaction(callback);
  }
}

function createTestORM(driver: MemoryDriver = new TrackingDriver()) {
  return createORM({
    adapter: {
      driver,
      scope: createAsyncLocalScope(new AsyncLocalStorage()),
    },
    entities: [],
  });
}

describe("SeederRunner", () => {
  it("runs named seeders sequentially in ORM scope and reports results", async () => {
    const driver = new TrackingDriver();
    const orm = createTestORM(driver);
    const order: string[] = [];
    const runner = new SeederRunner(orm, [
      defineSeeder({
        name: "users",
        async run({ sql: scopedSQL }) {
          order.push("users");
          await scopedSQL`SELECT ${1}`;
        },
      }),
      defineSeeder({
        name: "posts",
        transaction: "none",
        run() {
          order.push("posts");
        },
      }),
    ]);

    const results = await runner.run();

    expect(order).toEqual(["users", "posts"]);
    expect(results.map(({ name, usedTransaction }) => ({ name, usedTransaction }))).toEqual([
      { name: "users", usedTransaction: true },
      { name: "posts", usedTransaction: false },
    ]);
    expect(driver.transactions).toBe(1);
    expect(driver.statements[0]?.query.parameters).toEqual([1]);
    await orm.close();
  });

  it("supports named function seeders and selecting configured names", async () => {
    const orm = createTestORM();
    const order: string[] = [];
    async function legacyUsers() {
      order.push("legacyUsers");
      await sql`SELECT ${1}`;
    }
    const runner = new SeederRunner(orm, [
      legacyUsers,
      defineSeeder({ name: "posts", run() { order.push("posts"); } }),
    ]);

    expect(runner.list()).toEqual([
      { name: "legacyUsers", transaction: "auto" },
      { name: "posts", transaction: "auto" },
    ]);
    await runner.run({ only: ["posts"] });
    expect(order).toEqual(["posts"]);
    await expect(runner.run({ only: ["missing"] })).rejects.toThrow(ConfigurationError);
    await orm.close();
  });

  it("validates names and reports the seeder that failed", async () => {
    const orm = createTestORM();
    expect(() => new SeederRunner(orm, [
      defineSeeder({ name: "users", run() {} }),
      defineSeeder({ name: "users", run() {} }),
    ])).toThrow('Duplicate seeder name "users"');

    const runner = new SeederRunner(orm, [
      defineSeeder({
        name: "broken",
        run() {
          throw new Error("fixture failed");
        },
      }),
    ]);
    await expect(runner.run()).rejects.toMatchObject({
      name: "SeederError",
      seederName: "broken",
      message: 'Seeder "broken" failed: fixture failed',
    });
    await orm.close();
  });

  it("honors transaction requirements on adapters without transactions", async () => {
    const driver = new MemoryDriver();
    Object.assign(driver.capabilities, { transactions: false, savepoints: false });
    const orm = createTestORM(driver);
    const runner = new SeederRunner(orm, [
      defineSeeder({ name: "required", transaction: "required", run() {} }),
    ]);

    try {
      await runner.run();
      throw new Error("Expected required seeder transaction to fail.");
    } catch (cause) {
      expect(cause).toBeInstanceOf(SeederError);
      expect((cause as SeederError).cause).toBeInstanceOf(UnsupportedCapabilityError);
    }
    await orm.close();
  });
});
