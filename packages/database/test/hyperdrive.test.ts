import { describe, expect, it } from "vitest";
import { HyperdriveMySQLDriver, HyperdrivePostgresDriver } from "../src/runtime/cloudflare.js";

class FakePGClient {
  static created: FakePGClient[] = [];
  readonly queries: string[] = [];
  connects = 0;
  ends = 0;
  constructor(readonly failConnect = false) { FakePGClient.created.push(this); }
  async connect() { this.connects++; if (this.failConnect) throw new Error("connect failed"); }
  async query(text: string) { this.queries.push(text); return { rows: [{ text }], rowCount: 1 }; }
  async end() { this.ends++; }
}

class FakeMySQLConnection {
  static created: FakeMySQLConnection[] = [];
  readonly queries: string[] = [];
  ends = 0;
  constructor() { FakeMySQLConnection.created.push(this); }
  async execute(text: string) { this.queries.push(text); return [[{ text }], []] as [unknown, unknown]; }
  async beginTransaction() { this.queries.push("BEGIN"); }
  async commit() { this.queries.push("COMMIT"); }
  async rollback() { this.queries.push("ROLLBACK"); }
  async end() { this.ends++; }
}

const query = (text: string) => ({ text, parameters: [] });

describe("Hyperdrive drivers", () => {
  it("reuses one lazily connected PostgreSQL client per driver and closes it on close()", async () => {
    FakePGClient.created = [];
    const driver = new HyperdrivePostgresDriver(() => new FakePGClient() as never);
    expect(FakePGClient.created).toHaveLength(0);
    await Promise.all([driver.execute(query("SELECT 1")), driver.execute(query("SELECT 2"))]);
    await driver.execute(query("SELECT 3"));
    expect(FakePGClient.created).toHaveLength(1);
    const shared = FakePGClient.created[0]!;
    expect(shared).toMatchObject({ connects: 1, ends: 0 });
    expect(shared.queries).toEqual(["SELECT 1", "SELECT 2", "SELECT 3"]);

    // A transaction owns one dedicated connection for all of its statements.
    await driver.transaction(async (transaction) => { await transaction.execute(query("UPDATE t")); });
    const dedicated = FakePGClient.created[1]!;
    expect(dedicated.queries).toEqual(["BEGIN", "UPDATE t", "COMMIT"]);
    expect(dedicated.ends).toBe(1);
    expect(shared.queries).toHaveLength(3);

    await driver.close();
    expect(shared.ends).toBe(1);
    await driver.execute(query("SELECT 4"));
    expect(FakePGClient.created).toHaveLength(3);
  });

  it("retries the connection after a failed PostgreSQL connect", async () => {
    FakePGClient.created = [];
    let fail = true;
    const driver = new HyperdrivePostgresDriver(() => {
      const client = new FakePGClient(fail);
      fail = false;
      return client as never;
    });
    await expect(driver.execute(query("SELECT 1"))).rejects.toThrow("connect failed");
    await expect(driver.execute(query("SELECT 1"))).resolves.toMatchObject({ rows: [{ text: "SELECT 1" }] });
    expect(FakePGClient.created).toHaveLength(2);
    await driver.close();
  });

  it("reuses one lazily opened MySQL connection per driver and closes it on close()", async () => {
    FakeMySQLConnection.created = [];
    const driver = new HyperdriveMySQLDriver(async () => new FakeMySQLConnection() as never);
    await Promise.all([driver.execute(query("SELECT 1")), driver.execute(query("SELECT 2"))]);
    expect(FakeMySQLConnection.created).toHaveLength(1);
    await driver.transaction(async (transaction) => { await transaction.execute(query("UPDATE t")); });
    expect(FakeMySQLConnection.created[1]?.queries).toEqual(["BEGIN", "UPDATE t", "COMMIT"]);
    expect(FakeMySQLConnection.created[1]?.ends).toBe(1);
    await driver.close();
    expect(FakeMySQLConnection.created[0]?.ends).toBe(1);
  });
});
