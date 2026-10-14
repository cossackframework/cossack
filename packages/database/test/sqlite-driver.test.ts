import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { BaseEntity, Column, Entity, PrimaryColumn, SchemaBuilder, createORM } from "../src/index.js";
import { nodeSQLite } from "../src/runtime/node.js";

@Entity({ tableName: "ledger" })
class Ledger extends BaseEntity {
  @PrimaryColumn({ type: "integer" }) declare id: number;
  @Column({ type: "varchar" }) declare label: string;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

describe("SQLite driver", () => {
  it("serializes overlapping transactions so each commits or rolls back on its own", async () => {
    const orm = createORM({ adapter: await nodeSQLite(), entities: [Ledger] });
    try {
      await orm.run(async () => {
        await new SchemaBuilder().createTable(orm.schema().entities[0]!).execute(orm);
        const results = await Promise.allSettled([
          orm.transaction(async () => {
            await Ledger.insert({ id: 1, label: "first" });
            await tick();
            await Ledger.insert({ id: 2, label: "first" });
          }),
          orm.transaction(async () => {
            await Ledger.insert({ id: 3, label: "second" });
            await tick();
            await Ledger.insert({ id: 4, label: "second" });
          }),
          orm.transaction(async () => {
            await Ledger.insert({ id: 5, label: "rolled back" });
            await tick();
            throw new Error("requested rollback");
          }),
          // A statement outside any transaction must not join (or be rolled back with) another one.
          (async () => { await tick(); await Ledger.insert({ id: 6, label: "outside" }); })(),
        ]);
        expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "rejected", "fulfilled"]);
        expect((await Ledger.find({ order: { id: "asc" } })).map((row) => row.id)).toEqual([1, 2, 3, 4, 6]);
      });
    } finally {
      await orm.close();
    }
  });

  it("reports affected rows for DML with RETURNING", async () => {
    const orm = createORM({ adapter: await nodeSQLite(), entities: [Ledger] });
    try {
      await orm.run(async () => {
        await new SchemaBuilder().createTable(orm.schema().entities[0]!).execute(orm);
        const inserted = await orm.model(Ledger).insertQuery([{ id: 1, label: "a" }, { id: 2, label: "b" }])
          .returning("id").execute();
        expect(inserted.meta.rowsAffected).toBe(2);
        const updated = await orm.sql`UPDATE ledger SET label = 'c' RETURNING id`;
        expect(updated.meta.rowsAffected).toBe(2);
        const selected = await orm.sql`SELECT id FROM ledger`;
        expect(selected.meta.rowsAffected).toBe(0);
      });
    } finally {
      await orm.close();
    }
  });
});
