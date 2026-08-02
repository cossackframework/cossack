import { runORMToolingCommand } from './db-run.js';

export async function seederCommand(args, ctx) {
  const [action, ...rest] = args;
  if (action === '--help' || action === '-h' || action === 'help') {
    console.log(seederHelp());
    return 0;
  }
  if (action !== 'run' && action !== 'list') {
    console.error(`Unknown seeder subcommand: ${action || '(none)'}.\n${seederHelp()}`);
    return 1;
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
  run [--only <name>]   Run all or selected seeders.`;
}
