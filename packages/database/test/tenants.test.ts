import { describe, expect, it } from "vitest";
import { createTenantORMs } from "../src/index.js";
import { nodeSQLite } from "../src/runtime/node.js";

describe("createTenantORMs", () => {
  it("keeps an ORM that left the cache open while work holds it, and opens no second one", async () => {
    let opened = 0;
    const tenants = createTenantORMs({ adapter: () => { opened++; return nodeSQLite(); }, entities: [], migrations: [], max: 1 });
    const first = await tenants.open({ database: "acme", slug: "acme" });
    // Another tenant takes the one place: acme leaves the cache, but its work is not done.
    const other = await tenants.open({ database: "globex", slug: "globex" });
    await first.orm.run(async () => { expect((await first.orm.sql`SELECT 1 AS one`).rows).toEqual([{ one: 1 }]); });
    // A new request for acme gets the ORM that is still open.
    const again = await tenants.open({ database: "acme", slug: "acme" });
    expect(again.orm).toBe(first.orm);
    expect(opened).toBe(2);
    await first.release();
    await first.release();
    await again.orm.run(async () => { expect((await again.orm.sql`SELECT 2 AS two`).rows).toEqual([{ two: 2 }]); });
    await again.release();
    await other.release();
    await tenants.close();
  });

  it("closes an ORM that left the cache once its last work is done", async () => {
    const tenants = createTenantORMs({ adapter: () => nodeSQLite(), entities: [], migrations: [], max: 1 });
    const first = await tenants.open({ database: "acme", slug: "acme" });
    const other = await tenants.open({ database: "globex", slug: "globex" });
    await first.release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(() => first.orm.run(() => undefined)).toThrow();
    await other.release();
    await tenants.close();
  });
});
