import "reflect-metadata";
import { expect, it } from "vitest";
import { BaseEntity, Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn, VersionColumn, createORM, type Relation } from "../src/index.js";
import { nodeSQLite } from "../src/runtime/node.js";
import { createTableDDL } from "../src/schema/ddl.js";
import { sqliteDialect } from "../src/dialect/dialects.js";

@Entity()
class Team extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column({ type: "varchar" })
  declare name: string;

  @OneToMany(() => Member, (member) => member.team)
  declare members: Relation<Member[]>;
}

@Entity()
class Member extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column({ type: "varchar" })
  declare email: string;

  // A class default must never be mistaken for a change to an unloaded column.
  @Column({ type: "varchar", select: false })
  passwordHash = "";

  @Column({ type: "varchar", update: false })
  declare externalId: string;

  @Column({ type: "varchar", insert: false, nullable: true })
  declare computed: string | null;

  @VersionColumn()
  declare version: number;

  @ManyToOne(() => Team, (team) => team.members)
  declare team: Relation<Team>;
}

async function setup() {
  const orm = createORM({ adapter: await nodeSQLite(), entities: [Team, Member] });
  return orm;
}

async function withSchema(orm: Awaited<ReturnType<typeof setup>>, callback: () => Promise<void>) {
  await orm.run(async () => {
    for (const entity of orm.schema().entities) {
      for (const statement of createTableDDL(entity, sqliteDialect)) await orm.executeFragment(orm.sql.unsafe(statement), "ddl");
    }
    await callback();
  });
}

it("omits select:false columns by default and loads them on explicit selection", async () => {
  const orm = await setup();
  try {
    await withSchema(orm, async () => {
      const team = Team.create({ name: "core" });
      await team.save();
      const created = Member.create({ email: "ada@example.com", passwordHash: "SECRET_HASH", externalId: "ext-1", team });
      await created.save();

      const found = await Member.findOne({ where: { email: "ada@example.com" } });
      expect(found?.email).toBe("ada@example.com");
      expect(found?.passwordHash).toBeUndefined();
      expect(JSON.stringify(await Member.find())).not.toContain("SECRET_HASH");
      expect(JSON.stringify(await Member.query().getRawMany())).not.toContain("SECRET_HASH");

      expect((await Member.find({ select: ["id", "passwordHash"] }))[0]?.passwordHash).toBe("SECRET_HASH");
      expect((await Member.findOne({ select: ["id", "passwordHash"], where: { id: found!.id } }))?.passwordHash).toBe("SECRET_HASH");
      const extended = await Member.query().addSelect("passwordHash").where({ id: found!.id }).getOne();
      expect(extended?.passwordHash).toBe("SECRET_HASH");
      expect(extended?.email).toBe("ada@example.com");

      // Saving an entity without the hidden column keeps it and the version check intact.
      found!.email = "grace@example.com";
      await found!.save();
      expect(found!.version).toBe(2);
      expect((await Member.query().addSelect("passwordHash").getOne())?.passwordHash).toBe("SECRET_HASH");

      // reload() keeps hidden columns unloaded unless this instance holds them.
      await found!.reload();
      expect(found!.passwordHash).toBeUndefined();
      await extended!.reload();
      expect(extended!.passwordHash).toBe("SECRET_HASH");

      // Relation loading still has the join column.
      const withTeam = await Member.findOne({ where: { id: found!.id }, relations: ["team"] });
      expect(withTeam?.team?.name).toBe("core");
      const withMembers = await Team.findOne({ where: { id: team.id }, relations: ["members"] });
      expect(withMembers?.members.map((member) => member.email)).toEqual(["grace@example.com"]);
    });
  } finally { await orm.close(); }
});

it("rejects static insert/update of insert:false and update:false columns", async () => {
  const orm = await setup();
  try {
    await withSchema(orm, async () => {
      const team = Team.create({ name: "core" });
      await team.save();
      await expect(Member.update({ email: "a@example.com" }, { externalId: "forged" })).rejects.toThrow("update: false");
      await expect(Member.insert({ email: "b@example.com", passwordHash: "x", externalId: "ext-2", computed: "forged" })).rejects.toThrow("insert: false");
      await expect(Member.upsert({ email: "b@example.com", passwordHash: "x", externalId: "ext-2", computed: "forged" }, ["email"])).rejects.toThrow("insert: false");
      await Member.insert({ email: "c@example.com", passwordHash: "x", externalId: "ext-3", version: 1 });
      await Member.update({ email: "c@example.com" }, { email: "d@example.com" });
      expect((await Member.findOne({ where: { email: "d@example.com" } }))?.externalId).toBe("ext-3");
    });
  } finally { await orm.close(); }
});
