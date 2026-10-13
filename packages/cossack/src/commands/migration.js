import { showCommandHelp, validateCommand } from '../command-spec.js';
import { commandSpecs } from '../command-specs.js';
import { runORMToolingCommand } from './db-run.js';

export async function migrationCommand(args, ctx) {
  if (showCommandHelp(commandSpecs.migration, args, ctx, migrationHelp)) return 0;
  if (!validateCommand(commandSpecs.migration, args, ctx)) return 1;
  const [rawAction, ...rest] = args;
  const action = rawAction === 'latest' ? 'up' : rawAction;
  return runORMToolingCommand(['migration', action, ...rest], ctx);
}

export function migrationHelp() {
  return commandSpecs.migration.help(`cossack migration <subcommand>

Run deterministic ORM migrations from orm.config.ts.
Use cossack migration plan to preview pending SQL.

Subcommands:
  generate <name>   Generate a migration from the model snapshot diff.
  snapshot          Record current model metadata as the generation baseline.
  squash <name>     Generate one baseline migration from the current models.
  up                Apply all pending migrations.
  down              Revert the most recent migration.
  status            List migration state and changed checksums.
  rehash <name...>   Accept current checksums without running migrations.
  check             Fail unless all migrations are applied and checksums match.
  baseline          Record an existing schema after a clean drift check.
  plan              Preview pending migration SQL without applying it.`);
}
