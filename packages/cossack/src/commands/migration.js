import { runORMToolingCommand } from './db-run.js';

const ACTIONS = new Set([
  'generate',
  'snapshot',
  'squash',
  'up',
  'down',
  'status',
  'check',
  'baseline',
]);

export async function migrationCommand(args, ctx) {
  const [rawAction, ...rest] = args;
  const action = rawAction === 'latest' ? 'up' : rawAction;
  if (action === '--help' || action === '-h' || action === 'help') {
    console.log(migrationHelp());
    return 0;
  }
  if (!action || !ACTIONS.has(action)) {
    console.error(`Unknown migration subcommand: ${action || '(none)'}.\n${migrationHelp()}`);
    return 1;
  }
  return runORMToolingCommand(['migration', action, ...rest], ctx);
}

export function migrationHelp() {
  return `cossack migration <subcommand>

Run deterministic ORM migrations from orm.config.ts.

Subcommands:
  generate <name>   Generate a migration from the model snapshot diff.
  snapshot          Record current model metadata as the generation baseline.
  squash <name>     Generate one baseline migration from the current models.
  up                Apply all pending migrations.
  down              Revert the most recent migration.
  status            List migration state.
  check             Fail unless all migrations are applied and checksums match.
  baseline          Record an existing schema after a clean drift check.

Options:
  --config <path>              ORM config (default: orm.config.ts)
  --output <path>              Generated migration path
  --allow-destructive          Allow destructive diff operations
  --prune                      With squash, replace migration files and the barrel`;
}
