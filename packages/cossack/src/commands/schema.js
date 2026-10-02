import { runORMToolingCommand } from './db-run.js';
import { commandFailure } from '../output.js';

const ACTIONS = new Set(['pull', 'diff', 'check']);

export async function schemaCommand(args, ctx) {
  const [action, ...rest] = args;
  if (action === '--help' || action === '-h' || action === 'help') {
    console.log(schemaHelp());
    return 0;
  }
  if (!action || !ACTIONS.has(action)) {
    return commandFailure(ctx, 'schema', 'COSSACK_ACTION_UNKNOWN',
      `Unknown schema subcommand: ${action || '(none)'}.\n${schemaHelp()}`);
  }
  return runORMToolingCommand(['schema', action, ...rest], ctx);
}

export function schemaHelp() {
  return `cossack schema <subcommand>

Inspect physical schema against ORM model metadata.

Subcommands:
  pull     Generate decorated models from the database.
  diff     Print model/database differences.
  check    Fail when schema drift exists.

Options:
  --config <path>           ORM config (default: orm.config.ts)
  --env <name>              Select the application environment
  --target local|remote     Select the database target (default: local)
  --local, --remote         Target aliases
  --dry-run                 Preview generated files without writing
  --json                    Emit one versioned result; raw adapter output is suppressed`;
}
