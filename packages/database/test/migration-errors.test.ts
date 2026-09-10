import { describe, expect, it } from "vitest";
import { MemoryDriver } from "../src/adapter/memory.js";
import { MigrationError, QueryError } from "../src/errors.js";
import { MigrationRunner } from "../src/migration/runner.js";
import { createORM } from "../src/orm.js";
import { formatError } from "../src/tooling/format-error.js";

describe("migration errors", () => {
  for (const transactions of [true, false]) {
    it.each(["up", "down"] as const)(`preserves %s failure causes (transactions: ${transactions})`, async (direction) => {
      const cause = new Error("driver failure");
      const driver = new MemoryDriver("postgres", (query, operation) => {
        if (query.text.includes("EXTENSION")) throw cause;
        return { rows: operation === "select" && direction === "down" ? [{
          name: "0000_enable_postgis", checksum: "previous", batch: 1,
          applied_at: new Date().toISOString(),
        }] : [] };
      });
      Object.defineProperty(driver, "capabilities", {
        value: { ...driver.capabilities, transactions, batch: false },
      });
      const orm = createORM({ adapter: { driver }, entities: [] });
      const runner = new MigrationRunner(orm, [{
        name: "0000_enable_postgis",
        up({ schema, orm }) { schema.raw(orm.sql.fragment`CREATE EXTENSION postgis`); },
        down({ schema, orm }) { schema.raw(orm.sql.fragment`DROP EXTENSION postgis`); },
      }]);
      try {
        await expect(orm.run(() => runner[direction]())).rejects.toMatchObject({
          name: "MigrationError",
          message: "Migration 0000_enable_postgis failed",
          cause: { name: "QueryError", cause },
        });
      } finally {
        await orm.close();
      }
    });
  }

  it("formats nested causes without dumping unrelated driver fields", () => {
    const cause = Object.assign(new Error("extension unavailable"), {
      code: "0A000", detail: "missing control file", password: "secret",
    });
    const error = new MigrationError("Migration example failed", new QueryError("DDL failed", "CREATE EXTENSION postgis", cause));
    expect(formatError(error)).toBe(
      "Migration example failed\nCaused by: DDL failed\nSQL: CREATE EXTENSION postgis\n" +
      "Caused by: extension unavailable\nCode: 0A000\nDetail: missing control file",
    );
  });

  it("handles primitive causes and cyclic cause chains", () => {
    expect(formatError(new MigrationError("Migration example failed", "driver failure")))
      .toBe("Migration example failed\nCaused by: driver failure");
    const error = new Error("cyclic");
    error.cause = error;
    expect(formatError(error)).toBe("cyclic");
    expect(formatError(undefined)).toBe("undefined");
  });
});
