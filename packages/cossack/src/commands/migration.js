import { runORMToolingCommand } from './db-run.js';
import { commandFailure } from '../output.js';

const ACTIONS = new Set([
  'generate',
  'snapshot',
  'squash',
  'up',
  'down',
  'status',
  'check',
  'baseline',
  'plan',
]);

export async function migrationCommand(args, ctx) {
  const [rawAction, ...rest] = args;
  const action = rawAction === 'latest' ? 'up' : rawAction;
  if (action === '--help' || action === '-h' || action === 'help') {
    console.log(migrationHelp());
    return 0;
  }
  if (!action || !ACTIONS.has(action)) {
    return commandFailure(ctx, 'migration', 'COSSACK_ACTION_UNKNOWN',
      `Unknown migration subcommand: ${action || '(none)'}.\n${migrationHelp()}`);
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
  plan              Preview pending migration SQL without applying it.

Options:
  --config <path>              ORM config (default: orm.config.ts)
  --env <name>                 Select the Cloudflare/application environment
  --target <local|remote>      Explicit database target (default: local)
  --local, --remote            Target aliases
  --dry-run                    Preview database/file changes without applying
  --json                       Emit versioned results and diagnostics
  --direction <up|down>        Direction for migration plan (default: up)
  --output <path>              Generated migration path
  --allow-destructive          Allow destructive diff operations
  --prune                      With squash, replace migration files and the barrel`;
}
