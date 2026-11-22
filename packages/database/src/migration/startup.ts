import type { ORM } from "../orm.js";
import { MigrationRunner } from "./runner.js";
import type { Migration } from "./types.js";

/**
 * Apply the migrations that are not applied yet, from inside the application. Call it once
 * when the server starts, before the first query.
 *
 * Use it where a command cannot reach the database while the application runs: one process
 * owns a RomeDB file, so `cossack migration up` cannot open it beside a running server.
 * Each migration and its record apply as one transaction or one atomic batch.
 *
 * A database that is up to date costs one read. When two servers start together, one
 * applies a migration and the other finds it applied.
 *
 * @returns the names of the migrations this call applied.
 */
export async function applyPendingMigrations(orm: ORM, migrations: readonly Migration[]): Promise<readonly string[]> {
  return orm.run(async () => {
    const runner = new MigrationRunner(orm, migrations);
    // A read-only look first: nothing is written to a database that is up to date.
    const statuses = await runner.status({ readOnly: true });
    if (!statuses.some((status) => status.state !== "applied")) return [];
    try {
      return await runner.up();
    } catch (cause) {
      // Another server may have applied the same migration between the look and the write.
      const after = await runner.status({ readOnly: true });
      if (after.some((status) => status.state !== "applied")) throw cause;
      return [];
    }
  });
}
