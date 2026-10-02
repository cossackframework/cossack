import { showCommandHelp, validateCommand } from '../command-spec.js';
import { commandSpecs } from '../command-specs.js';
import { runORMToolingCommand } from './db-run.js';

export async function schemaCommand(args, ctx) {
  if (showCommandHelp(commandSpecs.schema, args, ctx, schemaHelp)) return 0;
  if (!validateCommand(commandSpecs.schema, args, ctx)) return 1;
  const [action, ...rest] = args;
  return runORMToolingCommand(['schema', action, ...rest], ctx);
}

export function schemaHelp() {
  return commandSpecs.schema.help(`cossack schema <subcommand>

Inspect physical schema against ORM model metadata.

Subcommands:
  pull     Generate decorated models from the database.
  diff     Print model/database differences.
  check    Fail when schema drift exists.`);
}
