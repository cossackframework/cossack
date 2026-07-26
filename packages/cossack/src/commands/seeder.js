/**
 * `cossack seeder <subcommand>` — run seeders.
 *
 *   cossack seeder run [--only <name>]
 *
 * The tsx respawn happens in bin/cossack.js; this module imports the user's
 * `src/db/cli.ts` and `@cossackframework/database` at runtime.
 */
import { runSeederCommand } from './db-run.js';

export async function seederCommand(args, ctx) {
  const [sub, ...rest] = args;
  if (sub === 'run') {
    const only = parseOnly(rest, ctx);
    return runSeederCommand(ctx, only);
  }
  if (sub === '--help' || sub === '-h' || sub === 'help') {
    console.log(seederHelp());
    return 0;
  }
  console.error(`Unknown seeder subcommand: ${sub || '(none)'}.\n${seederHelp()}`);
  return 1;
}

function parseOnly(rest, ctx) {
  const idx = rest.findIndex((a) => a === '--only' || a.startsWith('--only='));
  if (idx === -1) return ctx?.flags?.only;
  const flag = rest[idx];
  if (flag.startsWith('--only=')) return flag.slice('--only='.length);
  return rest[idx + 1];
}

export function seederHelp() {
  return `cossack seeder <subcommand>

Run seeder files under src/seeders/.

Subcommands:
  run [--only <name>]    Run all (or one) seeder's default export run(db).

The command loads src/db/cli.ts → getCliClient() to build the client.`;
}
