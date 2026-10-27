import "reflect-metadata";
import { describe, expect, it } from "vitest";
import {
  BaseEntity,
  Column,
  DeleteDateColumn,
  Entity,
  IsNotNull,
  IsNull,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  SchemaBuilder,
  createORM,
  type FindWhere,
} from "../src/index.js";
import { nodeSQLite } from "../src/runtime/node.js";
import type { ORM } from "../src/orm.js";

@Entity({ tableName: "folders" })
class Folder extends BaseEntity {
  @PrimaryGeneratedColumn() declare id: number;
  @Column({ type: "varchar" }) declare name: string;
  @OneToMany(() => Document, (document) => document.folder) declare documents: Document[];
}

@Entity({ tableName: "documents" })
class Document extends BaseEntity {
  @PrimaryGeneratedColumn() declare id: number;
  @Column({ type: "varchar" }) declare title: string;
  @DeleteDateColumn() declare deletedAt: Date | null;
  @ManyToOne(() => Folder, (folder) => folder.documents) declare folder: Folder | null;
}

@Entity({ tableName: "plain" })
class Plain extends BaseEntity {
  @PrimaryGeneratedColumn() declare id: number;
  @Column({ type: "varchar" }) declare title: string;
}

async function setup(run: (orm: ORM) => Promise<void>): Promise<void> {
  const orm = createORM({ adapter: await nodeSQLite(), entities: [Folder, Document, Plain] });
  try {
    await orm.run(async () => {
      for (const entity of orm.schema().entities) await new SchemaBuilder().createTable(entity).execute(orm);
      const folder = await Folder.create({ name: "inbox" }).save();
      await Document.create({ title: "one", folder }).save();
      await Document.create({ title: "two", folder }).save();
      await Document.create({ title: "three", folder }).save();
      await run(orm);
    });
  } finally {
    await orm.close();
  }
}

const titles = (documents: readonly Document[]) => documents.map((document) => document.title).sort();

describe("soft delete", () => {
  it("IsNull() and IsNotNull() type-check against nullable columns without a cast", () => {
    const live: FindWhere<Document> = { deletedAt: IsNull() };
    const trashed: FindWhere<Document> = { deletedAt: IsNotNull() };
    expect(live.deletedAt).toEqual({ operator: "is-null" });
    expect(trashed.deletedAt).toEqual({ operator: "is-not-null" });
  });

  it("Model.delete() stamps the delete date and reads hide the row by default", () => setup(async () => {
    const result = await Document.delete({ title: "two" });
    expect(result.meta.rowsAffected).toBe(1);

    expect(titles(await Document.find())).toEqual(["one", "three"]);
    expect(await Document.findOne({ where: { title: "two" } })).toBeNull();
    expect(titles(await Document.findBy({ title: "two" }))).toEqual([]);
    expect(await Document.count()).toBe(2);
    expect(await Document.exists({ title: "two" })).toBe(false);
    expect(titles(await Document.query().getMany())).toEqual(["one", "three"]);

    const trashed = await Document.findOne({ where: { title: "two" }, withDeleted: true });
    expect(trashed?.deletedAt).toBeInstanceOf(Date);
  }));

  it("withDeleted includes soft-deleted rows in find(), count(), exists() and query()", () => setup(async () => {
    await Document.softDelete({ title: "two" });

    expect(titles(await Document.find({ withDeleted: true }))).toEqual(["one", "three", "two"]);
    expect(titles(await Document.find({ where: { deletedAt: IsNotNull() }, withDeleted: true }))).toEqual(["two"]);
    expect(await Document.count(undefined, { withDeleted: true })).toBe(3);
    expect(await Document.exists({ title: "two" }, { withDeleted: true })).toBe(true);
    expect(titles(await Document.query().withDeleted().getMany())).toEqual(["one", "three", "two"]);
    expect(await Document.query().withDeleted().count()).toBe(3);
  }));

  it("restore() clears the delete date; a second softDelete() does not touch trashed rows", () => setup(async () => {
    await Document.softDelete({ title: "two" });
    const stamped = (await Document.findOne({ where: { title: "two" }, withDeleted: true }))!.deletedAt;

    expect((await Document.softDelete({ title: "two" })).meta.rowsAffected).toBe(0);
    expect((await Document.findOne({ where: { title: "two" }, withDeleted: true }))!.deletedAt).toEqual(stamped);

    expect((await Document.restore({ title: "two" })).meta.rowsAffected).toBe(1);
    expect((await Document.restore({ title: "two" })).meta.rowsAffected).toBe(0);
    expect(titles(await Document.find())).toEqual(["one", "three", "two"]);
    expect((await Document.findOne({ where: { title: "two" } }))!.deletedAt).toBeNull();
  }));

  it("delete() with force, and deleteAll(), remove rows for real or soft-delete every row", () => setup(async () => {
    expect((await Document.delete({ title: "two" }, { force: true })).meta.rowsAffected).toBe(1);
    expect(await Document.count(undefined, { withDeleted: true })).toBe(2);

    await Document.deleteAll();
    expect(await Document.count()).toBe(0);
    expect(await Document.count(undefined, { withDeleted: true })).toBe(2);

    await Document.deleteAll({ force: true });
    expect(await Document.count(undefined, { withDeleted: true })).toBe(0);
  }));

  it("entity.remove() soft-deletes, entity.restore() brings it back, remove({ force }) deletes", () => setup(async () => {
    const document = (await Document.findOne({ where: { title: "one" } }))!;
    await document.remove();
    expect(document.deletedAt).toBeInstanceOf(Date);
    expect(await Document.exists({ title: "one" })).toBe(false);

    await document.restore();
    expect(document.deletedAt).toBeNull();
    expect(await Document.exists({ title: "one" })).toBe(true);

    await document.remove({ force: true });
    expect(await Document.exists({ title: "one" }, { withDeleted: true })).toBe(false);
  }));

  it("relation loading skips soft-deleted children", () => setup(async () => {
    await Document.softDelete({ title: "two" });
    const [folder] = await Folder.find({ relations: ["documents"] });
    expect(titles(folder!.documents)).toEqual(["one", "three"]);
  }));

  it("rejects an empty where for softDelete() and restore()", () => setup(async () => {
    await expect(Document.softDelete({})).rejects.toThrow(/softDelete\(\) with an empty where/);
    await expect(Document.restore([{}])).rejects.toThrow(/restore\(\) with an empty where/);
    expect(await Document.count()).toBe(3);
  }));

  it("softDelete() and restore() require a @DeleteDateColumn; delete() stays a hard delete without one", () => setup(async () => {
    await Plain.create({ title: "p" }).save();
    await expect(Plain.softDelete({ title: "p" })).rejects.toThrow(/requires a @DeleteDateColumn/);
    await expect(Plain.restore({ title: "p" })).rejects.toThrow(/requires a @DeleteDateColumn/);
    await expect((await Plain.findOne({ where: { title: "p" } }))!.restore()).rejects.toThrow(/requires a @DeleteDateColumn/);
    await Plain.delete({ title: "p" });
    expect(await Plain.count()).toBe(0);
  }));
});
