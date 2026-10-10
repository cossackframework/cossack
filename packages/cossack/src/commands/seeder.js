import { showCommandHelp, validateCommand } from '../command-spec.js';
import { commandSpecs } from '../command-specs.js';
import { runORMToolingCommand } from './db-run.js';

export async function seederCommand(args, ctx) {
  if (showCommandHelp(commandSpecs.seeder, args, ctx, seederHelp)) return 0;
  if (!validateCommand(commandSpecs.seeder, args, ctx)) return 1;
  const [action, ...rest] = args;
  // Keep the public `seeder`/`seed` command names while using ORM's canonical
  // `seed` command internally.
  return runORMToolingCommand(['seed', action, ...rest], ctx);
}

export function seederHelp() {
  return commandSpecs.seeder.help(`cossack seeder <subcommand>

Run deterministic seeders registered in orm.config.ts.

Subcommands:
  list                  List configured seeders.
  run [--only <name>]   Run all or selected seeders.`);
}
