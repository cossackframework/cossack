import { describe, expect, it } from "vitest";
import { mysql } from "../src/runtime/node.js";

interface CorePool {
  config: { connectionConfig: { timezone?: string; database?: string } };
  listeners(event: "connection"): ((connection: unknown) => void)[];
}

function corePool(adapter: Awaited<ReturnType<typeof mysql>>): CorePool {
  return (adapter.driver as unknown as { pool: { pool: CorePool } }).pool.pool;
}

function connectionConfig(adapter: Awaited<ReturnType<typeof mysql>>): { timezone?: string; database?: string } {
  return corePool(adapter).config.connectionConfig;
}

/** Statements the pool runs on a new connection before handing it out. */
function connectionSetup(adapter: Awaited<ReturnType<typeof mysql>>): string[] {
  const statements: string[] = [];
  const connection = { query: (text: string, callback?: () => void) => { statements.push(text); callback?.(); } };
  for (const listener of corePool(adapter).listeners("connection")) listener(connection);
  return statements;
}

describe("mysql2 pool options", () => {
  it("reads and writes DATETIME values in UTC by default", async () => {
    const fromUrl = await mysql("mysql://user:secret@localhost/app");
    expect(connectionConfig(fromUrl)).toMatchObject({ timezone: "Z", database: "app" });
    await fromUrl.driver.close();

    const fromObject = await mysql({ host: "localhost", database: "app" });
    expect(connectionConfig(fromObject).timezone).toBe("Z");
    await fromObject.driver.close();

    const explicit = await mysql({ host: "localhost", database: "app", timezone: "+07:00" });
    expect(connectionConfig(explicit).timezone).toBe("+07:00");
    await explicit.driver.close();
  });

  // DEFAULT CURRENT_TIMESTAMP and NOW() use the session time zone, which is the
  // server's zone unless set. The ORM stores UTC, so database-filled timestamps
  // must be UTC too.
  it("sets the session time zone to UTC on each new connection when the pool uses UTC", async () => {
    for (const options of ["mysql://user:secret@localhost/app", "mysql://user:secret@localhost/app?timezone=Z",
      { host: "localhost", database: "app" }, { host: "localhost", database: "app", timezone: "+00:00" }] as const) {
      const adapter = await mysql(options);
      expect(connectionSetup(adapter)).toEqual(["SET time_zone = '+00:00'"]);
      await adapter.driver.close();
    }
  });

  it("leaves the session time zone alone when the caller chose another zone", async () => {
    for (const options of ["mysql://user:secret@localhost/app?timezone=local", { host: "localhost", timezone: "+07:00" }] as const) {
      const adapter = await mysql(options);
      expect(connectionSetup(adapter)).toEqual([]);
      await adapter.driver.close();
    }
  });
});
