import { defineConfig } from "../../src/config.js";
import { MemoryDriver } from "../../src/adapter/memory.js";
import { defineSeeder } from "../../src/seeding/types.js";

export default defineConfig({
  adapter: context => ({ driver: new MemoryDriver(), tooling: {
    provider: "context-fixture", target: context.target, accountId: "selected-account",
    ...(context.environment ? { environment: context.environment } : {}),
  } }),
  entities: [],
  migrations: [{ name: "001_queued", up({ orm, schema }) {
    schema.raw(orm.sql.unsafe("CREATE TABLE users (id integer primary key)"));
  }, down({ schema }) { schema.dropTable("users"); } }],
  seeds: [defineSeeder({ name: "fixture", run() { throw new Error("Dry-run must not execute this callback"); } })],
});
