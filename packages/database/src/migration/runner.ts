import { MigrationError } from "../errors.js";
import type { ORM } from "../orm.js";
import { SchemaBuilder } from "../schema/builder.js";
import type { AppliedMigration, Migration, MigrationStatus, MigrationPlanEntry } from "./types.js";
import { dialectFor } from "../dialect/dialects.js";
import { renderOperation } from "../schema/ddl.js";
import type { SchemaOperation } from "../schema/operations.js";
import { compileSQL, SQLFragment } from "../sql/fragment.js";
import { digestEvidence, serializeEvidence, planTarget, executionPolicy, operationStatements, snapshotOperation } from "./plan.js";
import type { BatchStatement } from "../adapter/types.js";

async function checksum(migration: Migration): Promise<string> {
  if (!migration.operations && migration.up && migration.down) {
    const source = `${migration.name}\n${JSON.stringify(migration.replaces ?? [])}\n` +
      `${Function.prototype.toString.call(migration.up)}\n${Function.prototype.toString.call(migration.down)}`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  return digestEvidence({ name: migration.name, replaces: migration.replaces ?? [], operations: migration.operations,
    up: migration.up ? Function.prototype.toString.call(migration.up) : null,
    down: migration.down ? Function.prototype.toString.call(migration.down) : null });
}

export class MigrationRunner {
  private readonly planned = new WeakMap<object, { direction: "up" | "down"; history: string; checksums: string; output: string; target: string; definitions: readonly Migration[] }>();
  constructor(
    readonly orm: ORM,
    readonly migrations: readonly Migration[],
    readonly tableName = "_cossack_migrations",
  ) {}

  async ensureTable(): Promise<void> {
    const q = this.orm.sql.id.bind(this.orm.sql);
    await this.orm.executeFragment(this.orm.sql.fragment`
      CREATE TABLE IF NOT EXISTS ${q(this.tableName)} (
        ${q("name")} varchar(255) PRIMARY KEY NOT NULL,
        ${q("checksum")} varchar(64) NOT NULL,
        ${q("batch")} integer NOT NULL,
        ${q("applied_at")} varchar(64) NOT NULL
      )
    `, "ddl");
  }

  async applied(options: { readonly readOnly?: boolean } = {}): Promise<readonly AppliedMigration[]> {
    if (options.readOnly) {
      // Schema introspection deliberately hides migration bookkeeping. Query
      // the catalog directly, without creating a history table on fresh targets.
      const sql = this.orm.sql;
      const query = this.orm.driver.dialect === "sqlite"
        ? sql.fragment`PRAGMA table_info(${sql.id(this.tableName)})`
        : this.orm.driver.dialect === "postgres"
          ? sql.fragment`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ${this.tableName}`
          : sql.fragment`SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ${this.tableName}`;
      if (!(await this.orm.executeFragment(query, "select")).rows.length) return [];
    } else await this.ensureTable();
    const result = await this.orm.executeFragment<Record<string, unknown>>(
      this.orm.sql.fragment`SELECT ${this.orm.sql.id("name")}, ${this.orm.sql.id("checksum")}, ${this.orm.sql.id("batch")}, ${this.orm.sql.id("applied_at")} FROM ${this.orm.sql.id(this.tableName)} ORDER BY ${this.orm.sql.id("batch")}, ${this.orm.sql.id("name")}`,
      "select",
    );
    return result.rows.map((row) => ({
      name: String(row["name"]),
      checksum: String(row["checksum"]),
      batch: Number(row["batch"]),
      appliedAt: new Date(String(row["applied_at"])),
    }));
  }

  async status(options: { readonly readOnly?: boolean } = {}): Promise<readonly MigrationStatus[]> {
    const applied = new Map((await this.applied(options)).map((item) => [item.name, item]));
    const result: MigrationStatus[] = [];
    for (const migration of this.sorted()) {
      const value = applied.get(migration.name);
      const hash = await checksum(migration);
      result.push({
        migration,
        checksum: hash,
        ...(value === undefined ? {} : { applied: value }),
        state: !value ? "pending" : value.checksum === hash ? "applied" : "changed",
      });
    }
    return result;
  }

  /** Inspect declarative operations only. Application callbacks are never invoked. */
  async plan(direction: "up" | "down" = "up"): Promise<readonly MigrationPlanEntry[]> {
    const appliedRows = await this.applied({ readOnly: true });
    const history = new Set(appliedRows.map(item => item.name));
    const appliedByName = new Map(appliedRows.map(item => [item.name, item]));
    const definitions = this.sorted().map(migration => ({ ...migration,
      ...(migration.replaces ? { replaces: [...migration.replaces] } : {}),
      ...(migration.operations ? { operations: { up: migration.operations.up.map(snapshotOperation),
        ...(migration.operations.down ? { down: migration.operations.down.map(snapshotOperation) } : {}) } } : {}),
    }));
    const hashes = await Promise.all(definitions.map(checksum));
    const target = planTarget(this.orm);
    const statuses: MigrationStatus[] = definitions.map((migration, index) => {
      const applied = appliedByName.get(migration.name);
      return { migration, checksum: hashes[index]!, ...(applied ? { applied } : {}),
        state: !applied ? "pending" : applied.checksum === hashes[index] ? "applied" : "changed" };
    });
    const changed = statuses.find(item => item.state === "changed");
    if (changed) throw new MigrationError(`Applied migration ${changed.migration.name} has a changed checksum.`);
    const selected = direction === "up"
      ? statuses.filter(item => item.state === "pending")
      : statuses.filter(item => item.applied).sort((left, right) =>
        right.applied!.batch - left.applied!.batch || right.migration.name.localeCompare(left.migration.name)).slice(0, 1);
    const entries: MigrationPlanEntry[] = [];
    for (const status of selected) {
      let reason: string | undefined;
      const replacements = status.migration.replaces ?? [];
      const appliedReplacements = replacements.filter(name => history.has(name));
      if (direction === "up" && appliedReplacements.length && appliedReplacements.length !== replacements.length) {
        throw new MigrationError(`Cannot apply squashed migration ${status.migration.name}: only some replaced migrations are applied.`);
      }
      const consolidate = direction === "up" && replacements.length > 0 && appliedReplacements.length === replacements.length;
      const operations = status.migration.operations?.[direction];
      if (!consolidate && operations === undefined) {
        reason = "Migration callbacks are not executed during planning. Declare authoritative operations for this direction.";
      }
      let statements: MigrationPlanEntry["statements"] = [];
      try { statements = consolidate ? [] : operationStatements(operations ?? [], this.orm); }
      catch { reason = "The declared operations are unsupported by this provider and cannot be planned."; }
      const q = this.orm.sql.id.bind(this.orm.sql);
      const bookkeepingOperations: SQLFragment[] = [this.orm.sql.fragment`
        CREATE TABLE IF NOT EXISTS ${q(this.tableName)} (
          ${q("name")} varchar(255) PRIMARY KEY NOT NULL,
          ${q("checksum")} varchar(64) NOT NULL,
          ${q("batch")} integer NOT NULL,
          ${q("applied_at")} varchar(64) NOT NULL
        )
      `];
      if (consolidate) for (const name of replacements) bookkeepingOperations.push(this.orm.sql.fragment`DELETE FROM ${this.orm.sql.id(this.tableName)} WHERE ${this.orm.sql.id("name")} = ${name}`);
      if (direction === "up") bookkeepingOperations.push(this.orm.sql.fragment`INSERT INTO ${this.orm.sql.id(this.tableName)} (${this.orm.sql.id("name")}, ${this.orm.sql.id("checksum")}, ${this.orm.sql.id("batch")}, ${this.orm.sql.id("applied_at")}) VALUES (${status.migration.name}, ${status.checksum}, ${0}, ${"applied-at-apply-time"})`);
      else bookkeepingOperations.push(this.orm.sql.fragment`DELETE FROM ${this.orm.sql.id(this.tableName)} WHERE ${this.orm.sql.id("name")} = ${status.migration.name}`);
      const bookkeeping = operationStatements(bookkeepingOperations, this.orm);
      entries.push(Object.freeze({ target, ...executionPolicy(this.orm),
        affectedObjects: Object.freeze([...new Set([...statements, ...bookkeeping].flatMap(statement => statement.affectedObjects))]), name: status.migration.name, direction, checksum: status.checksum,
        mode: consolidate ? "consolidate" : direction === "up" ? "apply" : "revert",
        ...(replacements.length ? { replaces: Object.freeze([...replacements]) } : {}),
        statements, bookkeeping, complete: reason === undefined, ...(reason ? { reason } : {}) }));
    }
    const result = Object.freeze(entries);
    this.planned.set(result, { direction, history: serializeEvidence(appliedRows),
      checksums: serializeEvidence(hashes),
      output: serializeEvidence(result), target: serializeEvidence(target), definitions });
    return result;
  }

  /** Plans are bound to this live runner/connection and cannot be imported from JSON. */
  async applyPlan(plan: readonly MigrationPlanEntry[]): Promise<readonly string[]> {
    const evidence = this.planned.get(plan);
    if (!evidence || plan.some(entry => !entry.complete)) throw new MigrationError("Cannot apply an incomplete or foreign migration plan.");
    if (evidence.output !== serializeEvidence(plan) || evidence.target !== serializeEvidence(planTarget(this.orm)) ||
        evidence.history !== serializeEvidence(await this.applied({ readOnly: true })) ||
        evidence.checksums !== serializeEvidence(await Promise.all(this.sorted().map(checksum)))) {
      throw new MigrationError("Migration plan is stale. Replan after migration definitions, target or history changes.");
    }
    this.planned.delete(plan);
    if (!plan.length) return [];
    const execution = new MigrationRunner(this.orm, evidence.definitions, this.tableName);
    return evidence.direction === "up" ? execution.up({ count: plan.length }) : execution.down({ count: plan.length });
  }

  private async queueMigration(migration: Migration, direction: "up" | "down", schema: SchemaBuilder): Promise<void> {
    const operations = migration.operations?.[direction];
    if (migration.operations) {
      if (!operations) throw new MigrationError(`Migration ${migration.name} has no declarative ${direction} operations.`);
      const dialect = dialectFor(this.orm.driver.dialect);
      for (const operation of operations) {
        if (operation instanceof SQLFragment) schema.raw(operation);
        else for (const text of renderOperation(operation, dialect)) schema.raw(this.orm.sql.unsafe(text));
      }
    } else {
      const callback = migration[direction];
      if (!callback) throw new MigrationError(`Migration ${migration.name} has no ${direction} callback or operations.`);
      await callback({ orm: this.orm, schema });
    }
  }

  async up(options: { readonly count?: number } = {}): Promise<readonly string[]> {
    const statuses = await this.status();
    const changed = statuses.find((item) => item.state === "changed");
    if (changed) throw new MigrationError(`Applied migration ${changed.migration.name} has a changed checksum.`);
    const pending = statuses.filter((item) => item.state === "pending").slice(0, options.count);
    if (!pending.length) return [];
    const applied = await this.applied();
    const batch = Math.max(0, ...applied.map((item) => item.batch)) + 1;
    const names: string[] = [];
    for (const status of pending) {
      const replacements = status.migration.replaces ?? [];
      if (replacements.length) {
        const currentlyApplied = new Set((await this.applied()).map((item) => item.name));
        const appliedReplacements = replacements.filter((name) => currentlyApplied.has(name));
        if (appliedReplacements.length && appliedReplacements.length !== replacements.length) {
          throw new MigrationError(
            `Cannot apply squashed migration ${status.migration.name}: only ` +
            `${appliedReplacements.length} of ${replacements.length} replaced migrations are applied.`,
          );
        }
        if (appliedReplacements.length === replacements.length) {
          const consolidate = async () => {
            const schema = new SchemaBuilder();
            for (const name of replacements) {
              schema.raw(this.orm.sql.fragment`
                DELETE FROM ${this.orm.sql.id(this.tableName)}
                WHERE ${this.orm.sql.id("name")} = ${name}
              `);
            }
            await this.executeAtomic(
              schema,
              this.orm.sql.fragment`
                INSERT INTO ${this.orm.sql.id(this.tableName)}
                  (${this.orm.sql.id("name")}, ${this.orm.sql.id("checksum")}, ${this.orm.sql.id("batch")}, ${this.orm.sql.id("applied_at")})
                VALUES (${status.migration.name}, ${status.checksum}, ${batch}, ${new Date().toISOString()})
              `,
              "insert",
            );
          };
          await this.runMigration(status.migration.name, consolidate);
          names.push(status.migration.name);
          continue;
        }
      }
      const apply = async () => {
        const schema = new SchemaBuilder();
        await this.queueMigration(status.migration, "up", schema);
        const bookkeeping = this.orm.sql.fragment`
          INSERT INTO ${this.orm.sql.id(this.tableName)}
            (${this.orm.sql.id("name")}, ${this.orm.sql.id("checksum")}, ${this.orm.sql.id("batch")}, ${this.orm.sql.id("applied_at")})
          VALUES (${status.migration.name}, ${status.checksum}, ${batch}, ${new Date().toISOString()})
        `;
        await this.executeAtomic(schema, bookkeeping, "insert");
      };
      await this.runMigration(status.migration.name, apply);
      names.push(status.migration.name);
    }
    return names;
  }

  async down(options: { readonly count?: number } = {}): Promise<readonly string[]> {
    const statuses = await this.status();
    const changed = statuses.find(item => item.state === "changed");
    if (changed) throw new MigrationError(`Applied migration ${changed.migration.name} has a changed checksum.`);
    const applied = statuses
      .filter((item): item is MigrationStatus & { applied: AppliedMigration } => Boolean(item.applied))
      .sort((left, right) => right.applied.batch - left.applied.batch || right.migration.name.localeCompare(left.migration.name))
      .slice(0, options.count ?? 1);
    const names: string[] = [];
    for (const status of applied) {
      const revert = async () => {
        const schema = new SchemaBuilder();
        await this.queueMigration(status.migration, "down", schema);
        await this.executeAtomic(
          schema,
          this.orm.sql.fragment`DELETE FROM ${this.orm.sql.id(this.tableName)} WHERE ${this.orm.sql.id("name")} = ${status.migration.name}`,
          "delete",
        );
      };
      await this.runMigration(status.migration.name, revert);
      names.push(status.migration.name);
    }
    return names;
  }

  async check(): Promise<void> {
    const statuses = await this.status({ readOnly: true });
    const invalid = statuses.filter((item) => item.state !== "applied");
    if (invalid.length) {
      throw new MigrationError(
        `Migration check failed: ${invalid.map((item) => `${item.migration.name} (${item.state})`).join(", ")}.`,
      );
    }
  }

  async baseline(schemaHash: string): Promise<void> {
    await this.ensureTable();
    const name = `baseline:${schemaHash}`;
    await this.orm.executeFragment(this.orm.sql.fragment`
      INSERT INTO ${this.orm.sql.id(this.tableName)}
        (${this.orm.sql.id("name")}, ${this.orm.sql.id("checksum")}, ${this.orm.sql.id("batch")}, ${this.orm.sql.id("applied_at")})
      VALUES (${name}, ${schemaHash}, ${0}, ${new Date().toISOString()})
    `, "insert");
  }

  private async runMigration(name: string, action: () => Promise<void>): Promise<void> {
    try {
      if (this.orm.driver.capabilities.transactions) await this.orm.transaction(action);
      else await action();
    } catch (cause) {
      throw new MigrationError(`Migration ${name} failed`, cause);
    }
  }

  private sorted(): readonly Migration[] {
    const sorted = [...this.migrations].sort((left, right) => left.name.localeCompare(right.name));
    const duplicates = sorted.filter((item, index) => sorted[index - 1]?.name === item.name);
    if (duplicates.length) throw new MigrationError(`Duplicate migration name ${duplicates[0]?.name}.`);
    return sorted;
  }

  private async executeAtomic(
    schema: SchemaBuilder,
    bookkeeping: SQLFragment,
    bookkeepingOperation: "insert" | "delete",
  ): Promise<void> {
    if (!this.orm.driver.capabilities.transactions && this.orm.driver.capabilities.batch && this.orm.driver.batch) {
      const dialect = dialectFor(this.orm.driver.dialect);
      const statements: BatchStatement[] = schema.operations().flatMap((item): BatchStatement[] => {
        if (item instanceof SQLFragment) {
          return [{ query: compileSQL(item, dialect), operation: "ddl" as const }];
        }
        return renderOperation(item as SchemaOperation, dialect).map((text) => ({
          query: { text, parameters: [] },
          operation: "ddl" as const,
        }));
      });
      statements.push({
        query: compileSQL(bookkeeping, dialect),
        operation: bookkeepingOperation,
      });
      await this.orm.driver.batch(statements);
      return;
    }
    await schema.execute(this.orm);
    await this.orm.executeFragment(bookkeeping, bookkeepingOperation);
  }
}
