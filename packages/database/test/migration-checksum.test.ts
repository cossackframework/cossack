import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MigrationRunner, createORM, sql, type Migration } from "../src/index.js";
import { MemoryDriver } from "../src/adapter/memory.js";

// Build callbacks from exact source text: the test transform must not reformat them.
const fn = (source: string) => (0, eval)(`(${source})`) as NonNullable<Migration["up"]>;

const local = fn(`function up({ schema }) {
  // Create the table.
  schema.raw(sql.unsafe('CREATE TABLE "items" (id integer)'));
  schema.raw(helper({ a: 1, b: 2, }));
}`);
const bundled = fn(`function up({schema}){/* Create the table. */schema.raw(sql.unsafe("CREATE TABLE \\"items\\" (id integer)"))
schema.raw(helper({a:1,b:2}))}`);
const changed = fn(`function up({ schema }) {
  schema.raw(sql.unsafe('CREATE TABLE "things" (id integer)'));
  schema.raw(helper({ a: 1, b: 2 }));
}`);
const down = fn(`function down({ schema }) { schema.raw(sql.unsafe('DROP TABLE items')); }`);

async function checksumOf(migration: Migration, driver = new MemoryDriver()): Promise<string> {
  const orm = createORM({ adapter: { driver }, entities: [] });
  const [status] = await orm.run(() => new MigrationRunner(orm, [migration]).status({ readOnly: true }));
  await orm.close();
  return status!.checksum;
}

describe("migration checksums", () => {
  it("ignore comments, whitespace, semicolons, trailing commas and quote style in callback migrations", async () => {
    const first = await checksumOf({ name: "001_items", up: local, down });
    expect(await checksumOf({ name: "001_items", up: bundled, down })).toBe(first);
    expect(await checksumOf({ name: "001_items", up: changed, down })).not.toBe(first);
  });

  it("keep operation-based checksums unchanged", async () => {
    const migration: Migration = {
      name: "001_create_items",
      operations: {
        up: [sql.unsafe("CREATE TABLE items (id integer primary key)")],
        down: [sql.unsafe("DROP TABLE items")],
      },
    };
    expect(await checksumOf(migration)).toBe("0cb1d6e13e91990b70102b2a11c8da03465fc142f7ce84e8a037466a95c1ccf8");
  });

  it("accept the raw-source checksum stored by earlier releases for applied callback migrations", async () => {
    const migration: Migration = { name: "001_items", up: local, down };
    const legacy = createHash("sha256").update(
      `001_items\n[]\n${Function.prototype.toString.call(local)}\n${Function.prototype.toString.call(down)}`,
    ).digest("hex");
    const driver = new MemoryDriver("sqlite", (query) => ({
      rows: query.text.startsWith("PRAGMA")
        ? [{ name: "name" }]
        : [{ name: "001_items", checksum: legacy, batch: 1, applied_at: "2026-01-01 00:00:00" }],
    }));
    const orm = createORM({ adapter: { driver }, entities: [] });
    const [status] = await orm.run(() => new MigrationRunner(orm, [migration]).status({ readOnly: true }));
    expect(status?.state).toBe("applied");
    await orm.close();
  });
});
