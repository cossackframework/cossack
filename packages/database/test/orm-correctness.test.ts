import "reflect-metadata";
import { describe, expect, it } from "vitest";
import {
  AfterLoad,
  BaseEntity,
  Column,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  SchemaBuilder,
  createORM,
} from "../src/index.js";
import { nodeSQLite } from "../src/runtime/node.js";
import { D1Driver, type D1DatabaseBinding, type D1PreparedStatement, type D1Result } from "../src/runtime/cloudflare.js";
import { DatabaseSync } from "node:sqlite";
import type { ORM } from "../src/orm.js";

async function createTables(orm: ORM): Promise<void> {
  for (const entity of orm.schema().entities) await new SchemaBuilder().createTable(entity).execute(orm);
}

@Entity({ tableName: "authors" })
class Author extends BaseEntity {
  @PrimaryGeneratedColumn() declare id: number;
  @Column({ type: "varchar", unique: true }) declare email: string;
  @OneToMany(() => Article, (article) => article.author) declare articles: Article[];
  @OneToMany(() => Note, (note) => note.writer) declare notes: Note[];
}

@Entity({ tableName: "articles" })
class Article extends BaseEntity {
  @PrimaryGeneratedColumn() declare id: number;
  @Column({ type: "varchar" }) declare title: string;
  @ManyToOne(() => Author, (author) => author.articles) declare author: Author | null;
}

@Entity({ tableName: "notes" })
class Note extends BaseEntity {
  @PrimaryGeneratedColumn() declare id: number;
  @Column({ type: "varchar" }) declare body: string;
  @ManyToOne(() => Author, (author) => author.notes)
  @JoinColumn({ name: "writer_email", referencedColumnName: "email" })
  declare writer: Author | null;
}

describe("owning relation persistence", () => {
  it("persists a reassigned many-to-one relation on save()", async () => {
    const orm = createORM({ adapter: await nodeSQLite(), entities: [Author, Article, Note] });
    try {
      await orm.run(async () => {
        await createTables(orm);
        const ada = await Author.create({ email: "ada@example.com" }).save();
        const grace = await Author.create({ email: "grace@example.com" }).save();
        const article = await Article.create({ title: "Engines", author: ada }).save();

        article.author = grace;
        await article.save();
        const reloaded = await Article.findOne({ where: { id: article.id }, relations: ["author"] });
        expect(reloaded?.author?.email).toBe("grace@example.com");

        // Changing only the join column property still wins over the loaded relation object.
        (reloaded as unknown as { authorId: number }).authorId = ada.id;
        await reloaded!.save();
        expect((await Article.findOne({ where: { id: article.id }, relations: ["author"] }))?.author?.email)
          .toBe("ada@example.com");

        reloaded!.author = null;
        await reloaded!.save();
        const cleared = await Article.findOne({ where: { id: article.id }, relations: ["author"] });
        expect(cleared?.author).toBeNull();
      });
    } finally {
      await orm.close();
    }
  });

  it("loads one-to-many children keyed by the join column's referenced field", async () => {
    const orm = createORM({ adapter: await nodeSQLite(), entities: [Author, Article, Note] });
    try {
      await orm.run(async () => {
        await createTables(orm);
        const ada = await Author.create({ email: "ada@example.com" }).save();
        await Note.create({ body: "first", writer: ada }).save();
        await Note.create({ body: "second", writer: ada }).save();
        const found = await Author.findOne({ where: { id: ada.id }, relations: ["notes"] });
        expect(found?.notes.map((note) => note.body).sort()).toEqual(["first", "second"]);
      });
    } finally {
      await orm.close();
    }
  });
});

@Entity({ tableName: "hooked" })
class Hooked extends BaseEntity {
  @PrimaryColumn({ type: "integer" }) declare id: number;
  @Column({ type: "varchar" }) declare name: string;
  declare decorated?: string;

  @AfterLoad()
  async decorate(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (this.name === "explode") throw new Error("after-load failure");
    this.decorated = `loaded:${this.name}`;
  }
}

describe("@AfterLoad hooks", () => {
  it("awaits async hooks before returning entities and propagates their errors", async () => {
    const orm = createORM({ adapter: await nodeSQLite(), entities: [Hooked] });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await orm.run(async () => {
        await createTables(orm);
        await Hooked.insert([{ id: 1, name: "ok" }, { id: 2, name: "explode" }]);
        const found = await Hooked.findOne({ where: { id: 1 } });
        expect(found?.decorated).toBe("loaded:ok");
        await expect(Hooked.findOne({ where: { id: 2 } })).rejects.toThrow("after-load failure");
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await orm.close();
    }
  });
});

@Entity({ tableName: "profiles" })
class Profile extends BaseEntity {
  @PrimaryColumn({ type: "integer" }) declare id: number;
  @Column({ type: "json" }) declare settings: { theme: { dark: boolean }; tags: string[] };
}

describe("JSON dirty tracking", () => {
  it("detects nested mutations inside JSON columns", async () => {
    const orm = createORM({ adapter: await nodeSQLite(), entities: [Profile] });
    try {
      await orm.run(async () => {
        await createTables(orm);
        await Profile.insert({ id: 1, settings: { theme: { dark: false }, tags: ["a"] } });
        const profile = (await Profile.findOne({ where: { id: 1 } }))!;
        profile.settings.theme.dark = true;
        profile.settings.tags.push("b");
        await profile.save();
        const fresh = await Profile.findOne({ where: { id: 1 } });
        expect(fresh?.settings).toEqual({ theme: { dark: true }, tags: ["a", "b"] });
      });
    } finally {
      await orm.close();
    }
  });
});

/** A D1 binding backed by node:sqlite: no interactive transactions, atomic batches. */
class SQLiteD1Binding implements D1DatabaseBinding {
  readonly statements: string[] = [];
  constructor(readonly database = new DatabaseSync(":memory:")) {
    database.exec("PRAGMA foreign_keys = ON");
  }
  prepare(text: string): D1PreparedStatement {
    const binding = this;
    const statement = {
      text,
      values: [] as readonly unknown[],
      bind(...next: readonly unknown[]) { statement.values = next; return statement; },
      async all<Row>() { return binding.run<Row>(text, statement.values, true); },
      async run<Row>() { return binding.run<Row>(text, statement.values, false); },
    };
    return statement;
  }
  run<Row>(text: string, values: readonly unknown[], all: boolean): D1Result<Row> {
    this.statements.push(text);
    const prepared = this.database.prepare(text);
    if (all) return { success: true, results: prepared.all(...(values as never[])) as Row[] };
    const result = prepared.run(...(values as never[]));
    return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  async batch<Row>(statements: readonly D1PreparedStatement[]): Promise<readonly D1Result<Row>[]> {
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) => {
        const { text, values } = statement as D1PreparedStatement & { text: string; values: readonly unknown[] };
        return this.run<Row>(text, values, /\bRETURNING\b|^\s*SELECT/i.test(text));
      });
      this.database.exec("COMMIT");
      return results;
    } catch (cause) {
      this.database.exec("ROLLBACK");
      throw cause;
    }
  }
}

@Entity({ tableName: "roles" })
class Role extends BaseEntity {
  @PrimaryColumn({ type: "integer" }) declare id: number;
}

@Entity({ tableName: "members" })
class Member extends BaseEntity {
  @PrimaryColumn({ type: "integer" }) declare id: number;
  @ManyToMany(() => Role, undefined, { cascade: true }) @JoinTable({ name: "member_roles" }) declare roles: Role[];
}

describe("many-to-many join table sync", () => {
  it("chunks join rows by the provider parameter limit and never loses rows on failure", async () => {
    const binding = new SQLiteD1Binding();
    const orm = createORM({ adapter: { driver: new D1Driver(binding) }, entities: [Role, Member] });
    try {
      await orm.run(async () => {
        await createTables(orm);
        const roles = Array.from({ length: 120 }, (_, index) => ({ id: index + 1 }));
        await Role.insert(roles.slice(0, 60));
        await Role.insert(roles.slice(60));
        const member = Member.create({ id: 1, roles: (await Role.find()).slice() });
        // 120 join rows = 240 parameters; D1 allows 100 per statement.
        await member.save();
        expect((await orm.sql`SELECT COUNT(*) AS n FROM member_roles`).rows[0]).toEqual({ n: 120 });

        // A failing insert (duplicate join row) must not leave the member without roles.
        member.roles = [...member.roles.slice(0, 3), member.roles[0]!];
        await expect(member.save()).rejects.toThrow();
        expect((await orm.sql`SELECT COUNT(*) AS n FROM member_roles`).rows[0]).toEqual({ n: 120 });
      });
    } finally {
      await orm.close();
    }
  });
});
