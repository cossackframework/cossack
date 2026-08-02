import { runORMToolingCommand } from './db-run.js';

const ACTIONS = new Set(['pull', 'diff', 'check']);

export async function schemaCommand(args, ctx) {
  const [action, ...rest] = args;
  if (action === '--help' || action === '-h' || action === 'help') {
    console.log(schemaHelp());
    return 0;
  }
  if (!action || !ACTIONS.has(action)) {
    console.error(`Unknown schema subcommand: ${action || '(none)'}.\n${schemaHelp()}`);
    return 1;
  }
  return runORMToolingCommand(['schema', action, ...rest], ctx);
}

export function schemaHelp() {
  return `cossack schema <subcommand>

Inspect physical schema against ORM model metadata.

Subcommands:
  pull     Generate decorated models from the database.
  diff     Print model/database differences.
  check    Fail when schema drift exists.`;
}
