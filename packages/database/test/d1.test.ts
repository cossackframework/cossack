import "reflect-metadata";
import { describe, expect, it } from "vitest";
import {
  BaseEntity,
  Entity,
  PrimaryGeneratedColumn,
  UnsupportedCapabilityError,
  MigrationRunner,
  createORM,
  sql,
} from "../src/index.js";
import { D1Driver, type D1DatabaseBinding, type D1PreparedStatement } from "../src/runtime/cloudflare.js";

class Statement implements D1PreparedStatement {
  values: readonly unknown[] = [];
  constructor(readonly text: string) {}
  bind(...values: readonly unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }
  async all() { return { success: true, results: [] }; }
  async run() { return { success: true, results: [], meta: { changes: 1 } }; }
}

class Binding implements D1DatabaseBinding {
  readonly batches: readonly D1PreparedStatement[][] = [];
  prepare(sql: string) { return new Statement(sql); }
  async batch(statements: readonly D1PreparedStatement[]) {
    (this.batches as D1PreparedStatement[][]).push([...statements]);
    return statements.map(() => ({ success: true, results: [], meta: { changes: 1 } }));
  }
}

@Entity()
class D1Model extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;
}

describe("D1 policy", () => {
  it("uses prepared batches and rejects interactive transactions", async () => {
    const binding = new Binding();
    const driver = new D1Driver(binding);
    await driver.batch!([
      { query: { text: "INSERT INTO x VALUES (?)", parameters: [1] }, operation: "insert" },
      { query: { text: "INSERT INTO x VALUES (?)", parameters: [2] }, operation: "insert" },
    ]);
    expect(binding.batches[0]).toHaveLength(2);
    expect((binding.batches[0]?.[0] as Statement).values).toEqual([1]);

    const orm = createORM({ adapter: { driver }, entities: [D1Model] });
    await expect(orm.run(() => orm.transaction(async () => undefined)))
      .rejects.toThrow(UnsupportedCapabilityError);
    await orm.close();
  });

  it("applies migration statements and bookkeeping in one atomic D1 batch", async () => {
    const binding = new Binding();
    const orm = createORM({ adapter: { driver: new D1Driver(binding) }, entities: [] });
    const runner = new MigrationRunner(orm, [{
      name: "001_users",
      up({ schema }) {
        schema.raw(sql.unsafe("CREATE TABLE users (id integer primary key)"));
      },
      down({ schema }) {
        schema.raw(sql.unsafe("DROP TABLE users"));
      },
    }]);
    await orm.run(() => runner.up());
    const migrationBatch = binding.batches.at(-1) as Statement[];
    expect(migrationBatch).toHaveLength(2);
    expect(migrationBatch[0]?.text).toContain("CREATE TABLE users");
    expect(migrationBatch[1]?.text).toContain("_cossack_migrations");
    await orm.close();
  });
});
