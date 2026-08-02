import "reflect-metadata";
import { describe, expect, it } from "vitest";
import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  MigrationRunner,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
  createORM,
  sql,
} from "../src/index.js";
import { nodeSQLite } from "../src/runtime/node.js";
import { createTableDDL } from "../src/schema/ddl.js";
import { sqliteDialect } from "../src/dialect/dialects.js";

@Entity()
class Account extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column({ type: "varchar", unique: true })
  declare email: string;

  @Column({ type: "json" })
  declare profile: { theme: string };

  @CreateDateColumn()
  declare createdAt: Date;

  @UpdateDateColumn()
  declare updatedAt: Date;

  @VersionColumn()
  declare version: number;
}

describe("Node SQLite integration", () => {
  it("persists, hydrates codecs, dirty updates, reloads, and introspects", async () => {
    const orm = createORM({ adapter: await nodeSQLite(), entities: [Account] });
    await orm.run(async () => {
      for (const statement of createTableDDL(orm.schema().entities[0]!, sqliteDialect)) {
        await orm.executeFragment(orm.sql.unsafe(statement), "ddl");
      }
      const account = Account.create({ email: "ada@example.com", profile: { theme: "dark" } });
      await account.save();
      expect(account.id).toBe(1);
      expect(account.version).toBe(1);

      const found = await Account.findOne({ where: { email: "ada@example.com" } });
      expect(found).toBeInstanceOf(Account);
      expect(found?.profile).toEqual({ theme: "dark" });
      expect(found?.createdAt).toBeInstanceOf(Date);

      found!.profile = { theme: "light" };
      await found!.save();
      expect(found?.version).toBe(2);
      found!.email = "local-change@example.com";
      await found!.reload();
      expect(found?.email).toBe("ada@example.com");

      const physical = await orm.introspect();
      expect(physical.entities[0]?.columns.find((column) => column.columnName === "email")?.logicalType)
        .toBe("varchar");
      expect(physical.entities[0]?.columns.find((column) => column.columnName === "profile")?.logicalType)
        .toBe("json");

      expect(await Account.count()).toBe(1);
      expect(await Account.exists({ email: "ada@example.com" })).toBe(true);
      expect(await Account.query().sum("id")).toBe(1);
      const upsertedAt = new Date();
      await Account.upsert(
        {
          email: "ada@example.com",
          profile: { theme: "system" },
          createdAt: upsertedAt,
          updatedAt: upsertedAt,
          version: 1,
        },
        ["email"],
      );
      expect((await Account.findOne({ where: { email: "ada@example.com" } }))?.profile)
        .toEqual({ theme: "system" });

      await orm.transaction(async () => {
        await orm.transaction(async () => {
          expect(await Account.exists({ id: 1 })).toBe(true);
        });
      });
    });
    await orm.close();
  });

  it("consolidates applied migrations into a squashed baseline without replaying it", async () => {
    const orm = createORM({ adapter: await nodeSQLite(), entities: [] });
    const original = new MigrationRunner(orm, [{
      name: "001_create_items",
      up({ schema }) {
        schema.raw(sql.unsafe("CREATE TABLE items (id integer primary key)"));
      },
      down({ schema }) {
        schema.raw(sql.unsafe("DROP TABLE items"));
      },
    }, {
      name: "002_add_name",
      up({ schema }) {
        schema.raw(sql.unsafe("ALTER TABLE items ADD COLUMN name text"));
      },
      down({ schema }) {
        schema.raw(sql.unsafe("ALTER TABLE items DROP COLUMN name"));
      },
    }]);
    await orm.run(() => original.up());

    const squashed = new MigrationRunner(orm, [{
      name: "001_schema",
      replaces: ["001_create_items", "002_add_name"],
      up({ schema }) {
        schema.raw(sql.unsafe("CREATE TABLE items (id integer primary key, name text)"));
      },
      down() {
        throw new Error("baseline");
      },
    }]);
    expect(await orm.run(() => squashed.up())).toEqual(["001_schema"]);
    expect((await orm.run(() => squashed.applied())).map((item) => item.name))
      .toEqual(["001_schema"]);
    const table = await orm.executeFragment<{ name: string }>(
      orm.sql.fragment`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items'`,
      "select",
    );
    expect(table.rows).toEqual([{ name: "items" }]);
    await orm.close();
  });
});
