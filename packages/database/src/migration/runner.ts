import { MigrationError } from "../errors.js";
import type { ORM } from "../orm.js";
import { SchemaBuilder } from "../schema/builder.js";
import type { AppliedMigration, Migration, MigrationStatus } from "./types.js";
import { dialectFor } from "../dialect/dialects.js";
import { renderOperation } from "../schema/ddl.js";
import type { SchemaOperation } from "../schema/operations.js";
import { compileSQL, SQLFragment } from "../sql/fragment.js";
import type { BatchStatement } from "../adapter/types.js";

async function checksum(migration: Migration): Promise<string> {
  const bytes = new TextEncoder().encode(
    `${migration.name}\n${migration.up.toString()}\n${migration.down.toString()}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class MigrationRunner {
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

  async applied(): Promise<readonly AppliedMigration[]> {
    await this.ensureTable();
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

  async status(): Promise<readonly MigrationStatus[]> {
    const applied = new Map((await this.applied()).map((item) => [item.name, item]));
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
      const apply = async () => {
        const schema = new SchemaBuilder();
        await status.migration.up({ orm: this.orm, schema });
        const bookkeeping = this.orm.sql.fragment`
          INSERT INTO ${this.orm.sql.id(this.tableName)}
            (${this.orm.sql.id("name")}, ${this.orm.sql.id("checksum")}, ${this.orm.sql.id("batch")}, ${this.orm.sql.id("applied_at")})
          VALUES (${status.migration.name}, ${status.checksum}, ${batch}, ${new Date().toISOString()})
        `;
        await this.executeAtomic(schema, bookkeeping, "insert");
      };
      if (this.orm.driver.capabilities.transactions) await this.orm.transaction(apply);
      else await apply();
      names.push(status.migration.name);
    }
    return names;
  }

  async down(options: { readonly count?: number } = {}): Promise<readonly string[]> {
    const statuses = await this.status();
    const applied = statuses
      .filter((item): item is MigrationStatus & { applied: AppliedMigration } => Boolean(item.applied))
      .sort((left, right) => right.applied.batch - left.applied.batch || right.migration.name.localeCompare(left.migration.name))
      .slice(0, options.count ?? 1);
    const names: string[] = [];
    for (const status of applied) {
      const revert = async () => {
        const schema = new SchemaBuilder();
        await status.migration.down({ orm: this.orm, schema });
        await this.executeAtomic(
          schema,
          this.orm.sql.fragment`DELETE FROM ${this.orm.sql.id(this.tableName)} WHERE ${this.orm.sql.id("name")} = ${status.migration.name}`,
          "delete",
        );
      };
      if (this.orm.driver.capabilities.transactions) await this.orm.transaction(revert);
      else await revert();
      names.push(status.migration.name);
    }
    return names;
  }

  async check(): Promise<void> {
    const statuses = await this.status();
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
