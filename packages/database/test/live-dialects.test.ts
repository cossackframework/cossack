// Live runs of the ORM against real database engines.
//
// SQLite (node:sqlite) and embedded Turso always run. D1 runs on Miniflare's
// local D1 when `miniflare` can be imported. PostgreSQL and MySQL run only when
// a connection URL is set, and are skipped otherwise:
//
//   COSSACK_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/cossack_test
//   COSSACK_TEST_MYSQL_URL=mysql://user:pass@127.0.0.1:3306/cossack_test
//
// Point them at a dedicated, disposable database: the suite drops and creates
// its own `live_*` tables.
//
// Offset-less timestamps must decode as UTC whatever the process time zone is,
// so the suite runs in UTC+7. A local-time parse anywhere in a driver or codec
// shows up as a 7 hour (or one day) error.
const previousTimeZone = process.env.TZ;
process.env.TZ = "Asia/Bangkok";

import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BaseEntity,
  Column,
  ConfigurationError,
  CreateDateColumn,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  MoreThan,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  QueryError,
  SchemaBuilder,
  UnsupportedCapabilityError,
  UpdateDateColumn,
  VersionColumn,
  createORM,
  describeOperation,
  diffSchemas,
  type Relation,
} from "../src/index.js";
import type { Adapter } from "../src/adapter/types.js";
import type { ORM } from "../src/orm.js";
import { mysql, nodeSQLite, postgres } from "../src/runtime/node.js";
import { turso } from "../src/runtime/turso.js";
import { d1, hyperdriveMySQL, hyperdrivePostgres, type HyperdriveBinding } from "../src/runtime/cloudflare.js";
import { createAsyncLocalScope } from "../src/adapter/scope.js";
import { AsyncLocalStorage } from "node:async_hooks";

afterAll(() => {
  if (previousTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = previousTimeZone;
});

// ---------------------------------------------------------------------------
// Entities. Listed in creation order: referenced tables first.
// ---------------------------------------------------------------------------

@Entity({ tableName: "live_teams" })
class Team extends BaseEntity {
  @PrimaryGeneratedColumn() declare id: number;
  @Column({ type: "varchar", unique: true }) declare slug: string;
  @OneToMany(() => Member, (member) => member.team) declare members: Relation<Member[]>;
  @OneToMany(() => Note, (note) => note.teamBySlug) declare notes: Relation<Note[]>;
}

@Entity({ tableName: "live_roles" })
class Role extends BaseEntity {
  @PrimaryGeneratedColumn() declare id: number;
  @Column({ type: "varchar", unique: true }) declare name: string;
  @ManyToMany(() => Member, (member) => member.roles) declare members: Relation<Member[]>;
}

@Entity({ tableName: "live_members" })
class Member extends BaseEntity {
  @PrimaryGeneratedColumn() declare id: number;
  @Column({ type: "varchar", unique: true }) declare email: string;
  // A class default must never be mistaken for a change to an unloaded column.
  @Column({ type: "varchar", select: false }) passwordHash = "";
  @Column({ type: "varchar", update: false }) declare externalId: string;
  @Column({ type: "varchar", insert: false, nullable: true }) declare computed: string | null;
  @VersionColumn() declare version: number;
  @ManyToOne(() => Team, (team) => team.members, { nullable: true }) declare team: Relation<Team> | null;
  @ManyToMany(() => Role, (role) => role.members, { cascade: ["insert", "update"] })
  @JoinTable({ name: "live_member_roles" })
  declare roles: Relation<Role[]>;
  @OneToOne(() => Badge, (badge) => badge.member) declare badge: Relation<Badge> | null;
}

@Entity({ tableName: "live_badges" })
class Badge extends BaseEntity {
  @PrimaryGeneratedColumn() declare id: number;
  @Column({ type: "varchar" }) declare label: string;
  @OneToOne(() => Member, (member) => member.badge, { onDelete: "CASCADE" })
  @JoinColumn({ name: "member_id", referencedColumnName: "id" })
  declare member: Relation<Member>;
}

@Entity({ tableName: "live_notes" })
class Note extends BaseEntity {
  @PrimaryGeneratedColumn() declare id: number;
  @Column({ type: "varchar" }) declare body: string;
  // Joins on a non-primary unique column.
  @ManyToOne(() => Team, (team) => team.notes, { nullable: true })
  @JoinColumn({ name: "team_slug", referencedColumnName: "slug" })
  declare teamBySlug: Relation<Team> | null;
}

@Entity({ tableName: "live_ledger" })
class Ledger extends BaseEntity {
  @PrimaryColumn({ type: "integer" }) declare id: number;
  @Column({ type: "varchar" }) declare label: string;
}

@Entity({ tableName: "live_events" })
class Event extends BaseEntity {
  @PrimaryColumn({ type: "integer" }) declare id: number;
  @Column({ type: "varchar" }) declare name: string;
  @Column({ type: "datetime", nullable: true }) declare at: Date | null;
  @Column({ type: "date", nullable: true }) declare day: Date | null;
  @CreateDateColumn({ default: "CURRENT_TIMESTAMP" }) declare createdAt: Date;
  @UpdateDateColumn({ default: "CURRENT_TIMESTAMP" }) declare updatedAt: Date;
}

const entities = [Team, Role, Member, Badge, Note, Ledger, Event];
const tableNames = ["live_member_roles", "live_badges", "live_notes", "live_members", "live_roles", "live_teams", "live_ledger", "live_events"];

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

interface Target {
  readonly name: string;
  /** Why this target is skipped, or undefined when it runs. */
  readonly skip: string | undefined;
  /** Interactive transactions (D1 has none). */
  readonly transactions: boolean;
  /** Two transactions can be open at once on separate connections. */
  readonly parallelTransactions: boolean;
  /**
   * False when the adapter cannot set the session time zone to UTC. Hyperdrive
   * pools server connections, so CURRENT_TIMESTAMP defaults through its MySQL
   * adapter follow the server's time zone.
   */
  readonly utcSession?: false;
  open(): Promise<{ adapter: Adapter; dispose?: () => Promise<void> }>;
}

async function importMiniflare(): Promise<typeof import("miniflare") | undefined> {
  try {
    const moduleName = "miniflare";
    return await import(/* @vite-ignore */ moduleName);
  } catch {
    return undefined;
  }
}

const miniflare = await importMiniflare();
const postgresUrl = process.env.COSSACK_TEST_POSTGRES_URL;
const mysqlUrl = process.env.COSSACK_TEST_MYSQL_URL;

/** The Hyperdrive binding shape, pointed straight at a database server. */
function hyperdriveBinding(url: string): HyperdriveBinding {
  const parsed = new URL(url);
  return {
    connectionString: url,
    host: parsed.hostname,
    port: Number(parsed.port),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1),
  };
}

/** Cloudflare adapters take the request scope from the application (see docs/runtimes.md). */
function withScope(adapter: Adapter): Adapter {
  return { ...adapter, scope: createAsyncLocalScope(new AsyncLocalStorage()) };
}

const targets: Target[] = [
  {
    name: "sqlite (node:sqlite)",
    skip: undefined,
    transactions: true,
    parallelTransactions: false,
    open: async () => ({ adapter: await nodeSQLite() }),
  },
  {
    name: "turso (embedded)",
    skip: undefined,
    transactions: true,
    parallelTransactions: false,
    open: async () => ({ adapter: await turso({ path: ":memory:" }) }),
  },
  {
    name: "d1 (miniflare)",
    skip: miniflare ? undefined : "miniflare is not installed",
    transactions: false,
    parallelTransactions: false,
    open: async () => {
      const instance = new miniflare!.Miniflare({
        modules: true,
        script: "export default { fetch() { return new Response(null, { status: 204 }); } };",
        d1Databases: { DB: `live-${crypto.randomUUID()}` },
      });
      const binding = await instance.getD1Database("DB");
      return { adapter: withScope(await d1(binding as never)), dispose: () => instance.dispose() };
    },
  },
  {
    name: "postgres",
    skip: postgresUrl ? undefined : "COSSACK_TEST_POSTGRES_URL is not set",
    transactions: true,
    parallelTransactions: true,
    open: async () => ({ adapter: await postgres(postgresUrl!) }),
  },
  {
    name: "mysql",
    skip: mysqlUrl ? undefined : "COSSACK_TEST_MYSQL_URL is not set",
    transactions: true,
    parallelTransactions: true,
    open: async () => ({ adapter: await mysql(mysqlUrl!) }),
  },
  {
    name: "hyperdrive postgres driver",
    skip: postgresUrl ? undefined : "COSSACK_TEST_POSTGRES_URL is not set",
    transactions: true,
    parallelTransactions: true,
    open: async () => ({ adapter: withScope(await hyperdrivePostgres(hyperdriveBinding(postgresUrl!))) }),
  },
  {
    name: "hyperdrive mysql driver",
    skip: mysqlUrl ? undefined : "COSSACK_TEST_MYSQL_URL is not set",
    transactions: true,
    parallelTransactions: true,
    utcSession: false,
    open: async () => ({ adapter: withScope(await hyperdriveMySQL(hyperdriveBinding(mysqlUrl!))) }),
  },
];

async function dropTables(orm: ORM): Promise<void> {
  const dialect = orm.driver.dialect;
  if (dialect === "mysql") await orm.executeFragment(orm.sql.unsafe("SET FOREIGN_KEY_CHECKS = 0"), "raw");
  for (const table of tableNames) {
    const quoted = dialect === "mysql" ? `\`${table}\`` : `"${table}"`;
    await orm.executeFragment(orm.sql.unsafe(`DROP TABLE IF EXISTS ${quoted}${dialect === "postgres" ? " CASCADE" : ""}`), "ddl");
  }
  if (dialect === "mysql") await orm.executeFragment(orm.sql.unsafe("SET FOREIGN_KEY_CHECKS = 1"), "raw");
}

async function resetSchema(orm: ORM): Promise<void> {
  await dropTables(orm);
  const builder = new SchemaBuilder();
  for (const entity of orm.schema().entities) builder.createTable(entity);
  await builder.execute(orm);
}

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

for (const target of targets) {
  describe.skipIf(target.skip !== undefined)(`live ${target.name}`, () => {
    let orm: ORM;
    let dispose: (() => Promise<void>) | undefined;

    beforeAll(async () => {
      const opened = await target.open();
      dispose = opened.dispose;
      orm = createORM({ adapter: opened.adapter, entities });
    }, 60_000);

    afterAll(async () => {
      if (!orm) return;
      try { await orm.run(() => dropTables(orm)); } finally {
        await orm.close();
        await dispose?.();
      }
    }, 60_000);

    const live = (name: string, callback: (skip: (note: string) => void) => Promise<void>) =>
      it(name, (context) => orm.run(async () => {
        await resetSchema(orm);
        await callback((note) => context.skip(note));
      }), 60_000);

    describe("relation loading", () => {
      live("loads many-to-one, one-to-many, many-to-many and one-to-one relations in both directions", async () => {
        const core = await Team.create({ slug: "core" }).save();
        const docs = await Team.create({ slug: "docs" }).save();
        const admin = await Role.create({ name: "admin" }).save();
        const editor = await Role.create({ name: "editor" }).save();
        const ada = await Member.create({ email: "ada@example.com", passwordHash: "h", externalId: "e1", team: core, roles: [admin, editor] }).save();
        const grace = await Member.create({ email: "grace@example.com", passwordHash: "h", externalId: "e2", team: core, roles: [editor] }).save();
        const linus = await Member.create({ email: "linus@example.com", passwordHash: "h", externalId: "e3", team: null, roles: [] }).save();
        await Badge.create({ label: "founder", member: ada }).save();
        await Note.create({ body: "first", teamBySlug: docs }).save();
        await Note.create({ body: "second", teamBySlug: docs }).save();
        await Note.create({ body: "orphan", teamBySlug: null }).save();

        const members = await Member.find({ relations: ["team", "roles", "badge"], order: { id: "asc" } });
        expect(members.map((member) => member.email)).toEqual(["ada@example.com", "grace@example.com", "linus@example.com"]);
        expect(members.map((member) => member.team?.slug ?? null)).toEqual(["core", "core", null]);
        expect(members.map((member) => member.roles.map((role) => role.name).sort())).toEqual([["admin", "editor"], ["editor"], []]);
        expect(members.map((member) => member.badge?.label ?? null)).toEqual(["founder", null, null]);
        expect(members[0]!.team).toBeInstanceOf(Team);
        // One team object per row, loaded in one batch, never a shared mutable instance mix-up.
        expect(members[0]!.team!.id).toBe(core.id);

        const teams = await Team.find({ with: ["members", "notes"], order: { slug: "asc" } });
        expect(teams.map((team) => team.slug)).toEqual(["core", "docs"]);
        expect(teams[0]!.members.map((member) => member.email).sort()).toEqual(["ada@example.com", "grace@example.com"]);
        expect(teams[1]!.members).toEqual([]);
        expect(teams[0]!.notes).toEqual([]);
        expect(teams[1]!.notes.map((note) => note.body).sort()).toEqual(["first", "second"]);

        const roles = await Role.find({ relations: ["members"], order: { name: "asc" } });
        expect(roles.map((role) => role.members.map((member) => member.email).sort()))
          .toEqual([["ada@example.com"], ["ada@example.com", "grace@example.com"]]);

        const badge = await Badge.findOne({ where: { label: "founder" }, relations: ["member"] });
        expect(badge?.member.email).toBe("ada@example.com");

        const orphan = await Note.findOne({ where: { body: "orphan" }, relations: ["teamBySlug"] });
        expect(orphan?.teamBySlug).toBeNull();
        expect((await Note.findOne({ where: { body: "first" }, relations: ["teamBySlug"] }))?.teamBySlug?.slug).toBe("docs");
        expect(linus.id).toBeGreaterThan(grace.id);
      });

      live("persists reassigned owning relations and many-to-many changes", async () => {
        const core = await Team.create({ slug: "core" }).save();
        const docs = await Team.create({ slug: "docs" }).save();
        const admin = await Role.create({ name: "admin" }).save();
        const editor = await Role.create({ name: "editor" }).save();
        const member = await Member.create({ email: "ada@example.com", passwordHash: "h", externalId: "e1", team: core, roles: [admin] }).save();

        member.team = docs;
        member.roles = [editor];
        await member.save();
        let reloaded = await Member.findOne({ where: { id: member.id }, relations: ["team", "roles"] });
        expect(reloaded?.team?.slug).toBe("docs");
        expect(reloaded?.roles.map((role) => role.name)).toEqual(["editor"]);

        reloaded!.team = null;
        reloaded!.roles = [];
        await reloaded!.save();
        reloaded = await Member.findOne({ where: { id: member.id }, relations: ["team", "roles"] });
        expect(reloaded?.team).toBeNull();
        expect(reloaded?.roles).toEqual([]);
      });

      live("batches relation loading across many parents", async () => {
        const teams = [];
        for (let index = 0; index < 30; index++) teams.push(await Team.create({ slug: `team-${index}` }).save());
        for (const [index, team] of teams.entries()) {
          await Member.insert({ email: `m${index}@example.com`, passwordHash: "h", externalId: `e${index}`, teamId: team.id, version: 1 } as never);
        }
        const loaded = await Team.find({ relations: ["members"], order: { id: "asc" } });
        expect(loaded).toHaveLength(30);
        expect(loaded.every((team, index) => team.members.length === 1 && team.members[0]!.email === `m${index}@example.com`)).toBe(true);
      });
    });

    describe("transactions", () => {
      it.skipIf(!target.transactions)("serializes or isolates overlapping transactions so each commits or rolls back on its own", () =>
        orm.run(async () => {
          await resetSchema(orm);
          const results = await Promise.allSettled([
            orm.transaction(async () => {
              await Ledger.insert({ id: 1, label: "first" });
              await tick();
              await Ledger.insert({ id: 2, label: "first" });
            }),
            orm.transaction(async () => {
              await Ledger.insert({ id: 3, label: "second" });
              await tick();
              await orm.sql`INSERT INTO live_ledger (id, label) VALUES (${4}, ${"second"})`;
            }),
            orm.transaction(async () => {
              // Every write path inside the transaction must roll back with it.
              await Ledger.insert({ id: 5, label: "rolled back" });
              await Ledger.create({ id: 6, label: "rolled back" }).save();
              await orm.sql`INSERT INTO live_ledger (id, label) VALUES (${7}, ${"rolled back"})`;
              await tick();
              throw new Error("requested rollback");
            }),
            // A statement outside any transaction must not join (or be rolled back with) another one.
            (async () => { await tick(); await Ledger.insert({ id: 8, label: "outside" }); })(),
          ]);
          expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "rejected", "fulfilled"]);
          expect((await Ledger.find({ order: { id: "asc" } })).map((row) => row.id)).toEqual([1, 2, 3, 4, 8]);
        }), 60_000);

      it.skipIf(!target.parallelTransactions)("keeps two open transactions on separate connections and hides uncommitted rows", () =>
        orm.run(async () => {
          await resetSchema(orm);
          const bothWritten = [deferred(), deferred()];
          const proceed = deferred();
          const run = (index: number, id: number, fail: boolean) => orm.transaction(async () => {
            await Ledger.insert({ id, label: `tx-${index}` });
            bothWritten[index]!.resolve();
            await proceed.promise;
            // Each transaction sees its own write, never the other's uncommitted one.
            expect((await Ledger.find({ order: { id: "asc" } })).map((row) => row.id)).toEqual([id]);
            if (fail) throw new Error("requested rollback");
          });
          const first = run(0, 1, false);
          const second = run(1, 2, true);
          await Promise.all(bothWritten.map((item) => item.promise));
          // Both transactions are open at once; nothing is visible outside them yet.
          expect(await Ledger.count()).toBe(0);
          proceed.resolve();
          const outcome = await Promise.allSettled([first, second]);
          expect(outcome.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
          expect((await Ledger.find()).map((row) => row.id)).toEqual([1]);
        }), 60_000);

      it.skipIf(!target.transactions)("rolls back a nested transaction to its savepoint and keeps the outer writes", () =>
        orm.run(async () => {
          await resetSchema(orm);
          await orm.transaction(async () => {
            await Ledger.insert({ id: 1, label: "outer" });
            await expect(orm.transaction(async () => {
              await Ledger.insert({ id: 2, label: "inner" });
              throw new Error("inner rollback");
            })).rejects.toThrow("inner rollback");
            await orm.transaction(async () => { await Ledger.insert({ id: 3, label: "inner kept" }); });
          });
          expect((await Ledger.find({ order: { id: "asc" } })).map((row) => row.id)).toEqual([1, 3]);
        }), 60_000);

      it.skipIf(target.transactions)("rejects interactive transactions it cannot provide", () =>
        orm.run(async () => {
          await resetSchema(orm);
          await expect(orm.transaction(async () => { await Ledger.insert({ id: 1, label: "never" }); }))
            .rejects.toBeInstanceOf(UnsupportedCapabilityError);
          expect(await Ledger.count()).toBe(0);
        }), 60_000);

      live("fails the losing writer of a concurrent optimistic update", async () => {
        const created = await Member.create({ email: "ada@example.com", passwordHash: "h", externalId: "e1" }).save();
        const [left, right] = await Promise.all([Member.findOne({ where: { id: created.id } }), Member.findOne({ where: { id: created.id } })]);
        left!.email = "left@example.com";
        right!.email = "right@example.com";
        const outcome = await Promise.allSettled([left!.save(), right!.save()]);
        expect(outcome.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        const failure = outcome.find((result) => result.status === "rejected") as PromiseRejectedResult;
        expect(failure.reason).toBeInstanceOf(QueryError);
        expect(failure.reason.message).toContain("Optimistic lock failed");
        const stored = await Member.findOne({ where: { id: created.id } });
        expect(stored?.version).toBe(2);
        expect(["left@example.com", "right@example.com"]).toContain(stored?.email);
      });
    });

    describe("datetime round-trips", () => {
      const precise = new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6));
      // 23:30 UTC is already the next day in UTC+7; 999 ms must not round into the next second.
      const lateNight = new Date(Date.UTC(2026, 0, 2, 23, 30, 59, 999));

      live("round-trips datetime and date values exactly in a non-UTC process", async () => {
        expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-420);
        await Event.create({ id: 1, name: "precise", at: precise, day: new Date(Date.UTC(2026, 0, 2)) }).save();
        await Event.create({ id: 2, name: "late", at: lateNight, day: new Date(Date.UTC(2026, 11, 31)) }).save();
        await Event.create({ id: 3, name: "empty", at: null, day: null }).save();

        const [first, second, third] = await Event.find({ order: { id: "asc" } });
        expect(first?.at).toBeInstanceOf(Date);
        expect(first?.at?.toISOString()).toBe(precise.toISOString());
        expect(second?.at?.toISOString()).toBe(lateNight.toISOString());
        expect(first?.day?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
        expect(second?.day?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
        expect(third?.at).toBeNull();
        expect(third?.day).toBeNull();

        // Updating through the entity keeps the exact value as well.
        first!.at = lateNight;
        await first!.save();
        expect((await Event.findOne({ where: { id: 1 } }))?.at?.toISOString()).toBe(lateNight.toISOString());
      });

      live("decodes DEFAULT CURRENT_TIMESTAMP rows as UTC and orders them with application dates", async (skip) => {
        if (target.utcSession === false) {
          const skew = await orm.sql<{ skew: number }>`SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS skew`;
          if (Number(skew.rows[0]?.skew) !== 0) skip("the MySQL server time zone is not UTC; Hyperdrive needs a UTC server (docs/models.md)");
        }
        const before = new Date(Date.now() - 5_000);
        // The database fills created_at and updated_at.
        await orm.sql`INSERT INTO live_events (id, name) VALUES (${1}, ${"database default"})`;
        await Event.create({ id: 2, name: "application", at: precise }).save();
        const stored = (await Event.findOne({ where: { id: 1 } }))!;
        expect(stored.createdAt).toBeInstanceOf(Date);
        expect(Math.abs(stored.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
        expect(Math.abs(stored.updatedAt.getTime() - Date.now())).toBeLessThan(60_000);

        const application = (await Event.findOne({ where: { id: 2 } }))!;
        expect(Math.abs(application.createdAt.getTime() - Date.now())).toBeLessThan(60_000);

        // Database defaults and application-written timestamps compare in one order.
        const recent = await Event.find({ where: { createdAt: MoreThan(before) }, order: { id: "asc" } });
        expect(recent.map((event) => event.id)).toEqual([1, 2]);
        expect(await Event.count({ createdAt: MoreThan(new Date(Date.now() + 3_600_000)) } as never)).toBe(0);
      });

      live("matches ORM-written datetimes from raw SQL parameters", async () => {
        await Event.create({ id: 1, name: "raw", at: precise }).save();
        const equal = await orm.sql`UPDATE live_events SET name = ${"matched"} WHERE id = ${1} AND at = ${precise}`;
        expect(equal.meta.rowsAffected).toBe(1);
        const later = await orm.sql<{ id: number }>`SELECT id FROM live_events WHERE at > ${new Date(precise.getTime() - 1)}`;
        expect(later.rows.map((row) => Number(row.id))).toEqual([1]);
        const none = await orm.sql<{ id: number }>`SELECT id FROM live_events WHERE at > ${precise}`;
        expect(none.rows).toEqual([]);
        expect((await Event.find({ where: { at: precise } })).map((event) => event.id)).toEqual([1]);
      });
    });

    describe("schema", () => {
      live("introspects the tables it created without drift", async () => {
        const physical = await orm.introspect();
        const created = { ...physical, entities: physical.entities.filter((entity) => tableNames.includes(entity.tableName)) };
        expect(diffSchemas(created, orm.schema()).operations.map(describeOperation)).toEqual([]);
      });
    });

    describe("column options", () => {
      live("omits select:false columns by default and loads them on explicit selection", async () => {
        const team = await Team.create({ slug: "core" }).save();
        await Member.create({ email: "ada@example.com", passwordHash: "SECRET_HASH", externalId: "ext-1", team }).save();

        const found = await Member.findOne({ where: { email: "ada@example.com" } });
        expect(found?.email).toBe("ada@example.com");
        expect(found?.passwordHash).toBeUndefined();
        expect(JSON.stringify(await Member.find())).not.toContain("SECRET_HASH");
        expect(JSON.stringify(await Member.query().getMany())).not.toContain("SECRET_HASH");
        expect(JSON.stringify(await Member.query().getRawMany())).not.toContain("SECRET_HASH");

        expect((await Member.find({ select: ["id", "passwordHash"] }))[0]?.passwordHash).toBe("SECRET_HASH");
        // find({ select }) loads only the listed columns (docs/models.md).
        const listed = (await Member.find({ select: ["email"] }))[0] as Member | undefined;
        expect(listed?.email).toBe("ada@example.com");
        expect(listed?.id).toBeUndefined();
        expect(listed?.passwordHash).toBeUndefined();
        const extended = await Member.query().addSelect("passwordHash").where({ id: found!.id }).getOne();
        expect(extended?.passwordHash).toBe("SECRET_HASH");
        expect(extended?.email).toBe("ada@example.com");

        // Saving an entity without the hidden column keeps it and the version check intact.
        found!.email = "grace@example.com";
        await found!.save();
        expect(found!.version).toBe(2);
        expect((await Member.query().addSelect("passwordHash").getOne())?.passwordHash).toBe("SECRET_HASH");

        await found!.reload();
        expect(found!.passwordHash).toBeUndefined();
        await extended!.reload();
        expect(extended!.passwordHash).toBe("SECRET_HASH");

        // Relation loading still has the join column.
        const withTeam = await Member.findOne({ where: { id: found!.id }, relations: ["team"] });
        expect(withTeam?.team?.slug).toBe("core");
        expect(withTeam?.passwordHash).toBeUndefined();
        const withMembers = await Team.findOne({ where: { id: team.id }, relations: ["members"] });
        expect(withMembers?.members.map((member) => member.email)).toEqual(["grace@example.com"]);
        expect(JSON.stringify(withMembers)).not.toContain("SECRET_HASH");
      });

      live("skips insert:false and update:false columns on entity saves", async () => {
        const member = Member.create({ email: "ada@example.com", passwordHash: "h", externalId: "ext-1", computed: "ignored" });
        await member.save();
        const stored = await Member.findOne({ where: { id: member.id } });
        expect(stored?.computed).toBeNull();
        stored!.externalId = "forged";
        stored!.email = "grace@example.com";
        await stored!.save();
        const reloaded = await Member.findOne({ where: { id: member.id } });
        expect(reloaded?.externalId).toBe("ext-1");
        expect(reloaded?.email).toBe("grace@example.com");
      });

      live("rejects static writes to insert:false and update:false columns and never overwrites update:false on upsert", async () => {
        await expect(Member.update({ email: "a@example.com" }, { externalId: "forged" })).rejects.toThrow("update: false");
        await expect(Member.insert({ email: "b@example.com", passwordHash: "x", externalId: "ext-2", computed: "forged" })).rejects.toThrow("insert: false");
        await expect(Member.upsert({ email: "b@example.com", passwordHash: "x", externalId: "ext-2", computed: "forged" }, ["email"]))
          .rejects.toBeInstanceOf(ConfigurationError);
        expect(await Member.count()).toBe(0);
        await Member.insert({ email: "c@example.com", passwordHash: "x", externalId: "ext-3", version: 1 });
        await Member.upsert({ email: "c@example.com", passwordHash: "y", externalId: "ext-forged", version: 1 }, ["email"]);
        const upserted = await Member.findOne({ select: ["id", "email", "externalId", "passwordHash"], where: { email: "c@example.com" } });
        expect(upserted?.externalId).toBe("ext-3");
        expect(upserted?.passwordHash).toBe("y");
        await Member.upsert({ email: "d@example.com", passwordHash: "z", externalId: "ext-4", version: 1 }, ["email"]);
        expect((await Member.findOne({ where: { email: "d@example.com" } }))?.externalId).toBe("ext-4");
      });
    });
  });
}
