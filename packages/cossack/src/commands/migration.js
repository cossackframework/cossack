/**
 * `cossack migration <subcommand>` — run Kysely migrations.
 *
 *   cossack migration up        Apply all pending migrations.
 *   cossack migration down      Revert the most recent migration.
 *   cossack migration status    List migrations and their state.
 *
 * The tsx respawn happens in bin/cossack.js; this module imports the user's
 * `src/db/config.ts` and `@cossackframework/database` at runtime.
 */
import { runMigrationCommand, runMigrationStatus } from './db-run.js';

export async function migrationCommand(args, ctx) {
  const [sub, ...rest] = args;
  if (sub === 'up' || sub === 'latest') {
    return runMigrationCommand('latest', ctx);
  }
  if (sub === 'down') {
    return runMigrationCommand('down', ctx);
  }
  if (sub === 'status') {
    return runMigrationStatus(ctx);
  }
  if (sub === '--help' || sub === '-h' || sub === 'help') {
    console.log(migrationHelp());
    return 0;
  }
  console.error(`Unknown migration subcommand: ${sub || '(none)'}.\n${migrationHelp()}`);
  return 1;
}

export function migrationHelp() {
  return `cossack migration <subcommand>

Run Kysely migrations discovered under src/migrations/.

Subcommands:
  up        Apply all pending migrations.
  down      Revert the most recent migration.
  status    List migrations and whether each has run.

The command loads src/db/config.ts → getCliClient() to build the client.
Options:
  --force, -f    (unused; accepted for consistency).`;
}
