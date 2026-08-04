import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Adapter, Driver } from "../src/adapter/types.js";

const runtime = vi.hoisted(() => ({
  turso: vi.fn(),
  nodeSQLite: vi.fn(),
  postgres: vi.fn(),
  mysql: vi.fn(),
}));

vi.mock("../src/runtime/node.js", () => runtime);

import { SQL } from "../src/sql/client.js";

function fakeAdapter(): Adapter {
  const driver: Driver = {
    dialect: "sqlite",
    capabilities: {
      transactions: true,
      returning: true,
      savepoints: true,
      batch: false,
      reserveConnection: true,
      cancellation: false,
      parameterLimit: 999,
      batchLimit: 1,
    },
    execute: async <Row>() => ({
      rows: [] as Row[],
      meta: { dialect: "sqlite", operation: "raw", durationMs: 0 },
    }),
    transaction: async (callback) => callback(driver),
    reserve: async (callback) => callback(driver),
    close: vi.fn(async () => {}),
  };
  return { driver };
}

describe("SQL automatic adapter selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.turso.mockResolvedValue(fakeAdapter());
  });

  it("routes canonical libsql URLs to the Turso adapter", async () => {
    const client = new SQL("libsql://counter-example.turso.io");
    await client.close();

    expect(runtime.turso).toHaveBeenCalledWith({ url: "libsql://counter-example.turso.io" });
    expect(runtime.nodeSQLite).not.toHaveBeenCalled();
  });
});
