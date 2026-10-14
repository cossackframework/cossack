import "reflect-metadata";
import { describe, expect, it } from "vitest";
import {
  BaseEntity,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  MetadataError,
  PrimaryGeneratedColumn,
  createORM,
} from "../src/index.js";
import { MemoryDriver } from "../src/adapter/index.js";

@Entity()
class BlogPost extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column("varchar")
  declare title: string;

  @Column("boolean")
  declare published: boolean;

  @Column("datetime")
  declare publishedAt: Date;
}

describe("metadata", () => {
  it("uses reflected safe defaults and plural snake_case names", async () => {
    const orm = createORM({ adapter: { driver: new MemoryDriver() }, entities: [BlogPost] });
    const schema = orm.schema();
    expect(schema.entities[0]?.tableName).toBe("blog_posts");
    expect(schema.entities[0]?.columns.map((column) => [column.columnName, column.logicalType])).toEqual([
      ["id", "integer"],
      ["title", "varchar"],
      ["published", "boolean"],
      ["published_at", "datetime"],
    ]);
    await orm.close();
  });

  it("reads design:type metadata when the legacy TypeScript compiler emits it", async () => {
    class Reflected extends BaseEntity {
      declare id: number;
      declare label: string;
    }
    Reflect.defineMetadata("design:type", Number, Reflected.prototype, "id");
    PrimaryGeneratedColumn()(Reflected.prototype, "id");
    Reflect.defineMetadata("design:type", String, Reflected.prototype, "label");
    Column()(Reflected.prototype, "label");
    Entity()(Reflected);
    const orm = createORM({ adapter: { driver: new MemoryDriver() }, entities: [Reflected] });
    expect(orm.schema().entities[0]?.columns[1]?.logicalType).toBe("varchar");
    await orm.close();
  });

  it("rejects ambiguous reflected types", () => {
    @Entity()
    class Invalid extends BaseEntity {
      @PrimaryGeneratedColumn()
      declare id: number;

      @Column()
      declare settings: Record<string, unknown>;
    }
    expect(() => createORM({
      adapter: { driver: new MemoryDriver() },
      entities: [Invalid],
    })).toThrow(/ambiguous type/i);
  });

  it("requires explicit relation targets in the entity list", () => {
    @Entity()
    class Team extends BaseEntity {
      @PrimaryGeneratedColumn()
      declare id: number;
    }
    @Entity()
    class Member extends BaseEntity {
      @PrimaryGeneratedColumn()
      declare id: number;

      @ManyToOne(() => Team)
      declare team: Team;
    }
    expect(() => createORM({
      adapter: { driver: new MemoryDriver() },
      entities: [Member],
    })).toThrow(MetadataError);
  });

  it("creates typed physical join columns while preserving logical relation metadata", async () => {
    @Entity()
    class Team extends BaseEntity {
      @PrimaryGeneratedColumn()
      declare id: number;
    }
    @Entity()
    class Member extends BaseEntity {
      @PrimaryGeneratedColumn()
      declare id: number;

      @ManyToOne(() => Team, { nullable: false })
      @JoinColumn()
      declare team: Team;
    }
    const orm = createORM({
      adapter: { driver: new MemoryDriver() },
      entities: [Team, Member],
    });
    const member = orm.schema().entities.find((entity) => entity.modelName === "Member")!;
    expect(member.columns.find((column) => column.columnName === "team_id")).toMatchObject({
      propertyName: "teamId",
      logicalType: "integer",
      nullable: false,
    });
    expect(member.relations[0]).toMatchObject({
      targetEntity: "Team",
      targetTableName: "teams",
      joinColumn: "team_id",
      referencedColumn: "id",
      referencedProperty: "id",
      physical: true,
    });
    await orm.close();
  });

  it("sizes a synthesized join column like the column it references", async () => {
    @Entity({ tableName: "sized_accounts" })
    class SizedAccount extends BaseEntity {
      @PrimaryGeneratedColumn() declare id: number;
      @Column({ type: "varchar", length: 64, unique: true }) declare handle: string;
      @Column({ type: "varchar", unique: true }) declare email: string;
      @Column({ type: "decimal", precision: 12, scale: 2, unique: true }) declare code: string;
    }

    @Entity({ tableName: "sized_notes" })
    class SizedNote extends BaseEntity {
      @PrimaryGeneratedColumn() declare id: number;
      @ManyToOne(() => SizedAccount) @JoinColumn({ name: "account_handle", referencedColumnName: "handle" }) declare byHandle: SizedAccount;
      @ManyToOne(() => SizedAccount) @JoinColumn({ name: "account_email", referencedColumnName: "email" }) declare byEmail: SizedAccount;
      @ManyToOne(() => SizedAccount) @JoinColumn({ name: "account_code", referencedColumnName: "code" }) declare byCode: SizedAccount;
    }

    const orm = createORM({ adapter: { driver: new MemoryDriver("postgres") }, entities: [SizedAccount, SizedNote] });
    const note = orm.schema().entities.find((entity) => entity.modelName === "SizedNote")!;
    const column = (name: string) => note.columns.find((candidate) => candidate.columnName === name);
    // Without the referenced size, varchar(64) keys got a varchar(255) join column and drift checks always failed.
    expect(column("account_handle")).toMatchObject({ logicalType: "varchar", length: 64 });
    expect(column("account_email")).toMatchObject({ logicalType: "varchar", length: 255 });
    expect(column("account_code")).toMatchObject({ logicalType: "decimal", precision: 12, scale: 2 });
    await orm.close();
  });
});
