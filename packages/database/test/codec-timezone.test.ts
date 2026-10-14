// Offset-less timestamps must decode as UTC whatever the process time zone is.
// Set a UTC+7 zone before any Date is created so a local-time parse would be 7 hours off.
const previousTimeZone = process.env.TZ;
process.env.TZ = "Asia/Bangkok";

import "reflect-metadata";
import { afterAll, describe, expect, it } from "vitest";
import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  MoreThan,
  PrimaryColumn,
  SchemaBuilder,
  createORM,
} from "../src/index.js";
import { decodeValue, encodeValue } from "../src/codec.js";
import type { ColumnMetadata } from "../src/metadata/types.js";
import { nodeSQLite } from "../src/runtime/node.js";

afterAll(() => {
  if (previousTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = previousTimeZone;
});

function column(logicalType: ColumnMetadata["logicalType"]): ColumnMetadata {
  return {
    propertyName: "value", columnName: "value", logicalType, nullable: false, primary: false,
    generated: false, unique: false, insert: true, update: true, select: true,
  };
}

@Entity({ tableName: "events" })
class Event extends BaseEntity {
  @PrimaryColumn({ type: "integer" }) declare id: number;
  @Column({ type: "varchar" }) declare name: string;
  @CreateDateColumn({ default: "CURRENT_TIMESTAMP" }) declare createdAt: Date;
}

describe("datetime codec in a non-UTC time zone", () => {
  it("runs in UTC+7", () => {
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-420);
  });

  it("decodes offset-less database timestamps as UTC", () => {
    const expected = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
    expect(decodeValue(column("datetime"), "2026-01-02 03:04:05")).toEqual(expected);
    expect(decodeValue(column("datetime"), "2026-01-02T03:04:05")).toEqual(expected);
    expect(decodeValue(column("datetime"), "2026-01-02 03:04:05.000")).toEqual(expected);
    expect(decodeValue(column("datetime"), "2026-01-02T03:04:05.000Z")).toEqual(expected);
    expect(decodeValue(column("datetime"), "2026-01-02 10:04:05+07")).toEqual(expected);
    expect(decodeValue(column("date"), "2026-01-02")).toEqual(new Date(Date.UTC(2026, 0, 2)));
  });

  it("encodes dates in each dialect's storage format", () => {
    const value = new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6));
    expect(encodeValue(column("datetime"), value, "sqlite")).toBe("2026-01-02 03:04:05.006");
    expect(encodeValue(column("datetime"), value, "mysql")).toBe("2026-01-02 03:04:05.006");
    expect(encodeValue(column("datetime"), value, "postgres")).toBe("2026-01-02T03:04:05.006Z");
    expect(encodeValue(column("date"), value, "sqlite")).toBe("2026-01-02");
    expect(encodeValue(column("date"), value, "postgres")).toBe("2026-01-02");
  });

  it("round-trips entity dates and compares them with DEFAULT CURRENT_TIMESTAMP rows on SQLite", async () => {
    const orm = createORM({ adapter: await nodeSQLite(), entities: [Event] });
    try {
      await orm.run(async () => {
        await new SchemaBuilder().createTable(orm.schema().entities[0]!).execute(orm);
        const before = Date.now() - 2_000;
        // The database fills created_at with CURRENT_TIMESTAMP (UTC, no offset).
        await orm.sql`INSERT INTO events (id, name) VALUES (${1}, ${"database default"})`;
        const stored = (await Event.findOne({ where: { id: 1 } }))!;
        expect(Math.abs(stored.createdAt.getTime() - Date.now())).toBeLessThan(10_000);

        const explicit = new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6));
        await Event.create({ id: 2, name: "application", createdAt: explicit }).save();
        expect((await Event.findOne({ where: { id: 2 } }))?.createdAt).toEqual(explicit);

        // Application dates and database defaults share one sortable text format.
        const recent = await Event.find({ where: { createdAt: MoreThan(new Date(before)) } });
        expect(recent.map((event) => event.id)).toEqual([1]);
      });
    } finally {
      await orm.close();
    }
  });
});
