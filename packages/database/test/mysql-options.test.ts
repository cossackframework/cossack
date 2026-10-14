import { describe, expect, it } from "vitest";
import { mysql } from "../src/runtime/node.js";

function connectionConfig(adapter: Awaited<ReturnType<typeof mysql>>): { timezone?: string; database?: string } {
  return (adapter.driver as unknown as { pool: { pool: { config: { connectionConfig: { timezone?: string; database?: string } } } } })
    .pool.pool.config.connectionConfig;
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
});
