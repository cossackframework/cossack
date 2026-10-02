import { runORMToolingCommand } from './db-run.js';
import { commandFailure } from '../output.js';

export async function seederCommand(args, ctx) {
  const [action, ...rest] = args;
  if (action === '--help' || action === '-h' || action === 'help') {
    console.log(seederHelp());
    return 0;
  }
  if (action !== 'run' && action !== 'list') {
    return commandFailure(ctx, 'seed', 'COSSACK_ACTION_UNKNOWN',
      `Unknown seeder subcommand: ${action || '(none)'}.\n${seederHelp()}`);
  }
  // Keep the public `seeder`/`seed` command names while using ORM's canonical
  // `seed` command internally.
  return runORMToolingCommand(['seed', action, ...rest], ctx);
}

export function seederHelp() {
  return `cossack seeder <subcommand>

Run deterministic seeders registered in orm.config.ts.

Subcommands:
  list                  List configured seeders.
  run [--only <name>]   Run all or selected seeders.

Options:
  --config <path>           ORM config (default: orm.config.ts)
  --env <name>              Select the application environment
  --target local|remote     Select the database target (default: local)
  --local, --remote         Target aliases
  --dry-run                 List selected callbacks without running them
  --json                    Emit one versioned result; raw adapter output is suppressed`;
}
