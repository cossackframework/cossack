/**
 * Command resolution + top-level dispatch.
 *
 * Each command module exports `async function run(args, ctx): Promise<number>`
 * where `args` is the remaining argv after the command/subcommand and `ctx`
 * holds shared flags. Returns a process exit code.
 */
import { versionCommand } from './commands/version.js';
import { routesCommand } from './commands/routes.js';
import { generateCommand } from './commands/generate.js';
import { deleteCommand } from './commands/delete.js';
import { createCommand } from './commands/create.js';
import { ssgCommand } from './commands/ssg.js';
import { addCommand } from './commands/add.js';
import { devCommand } from './commands/dev.js';
import { buildCommand } from './commands/build.js';
import { startCommand } from './commands/start.js';
import { infoCommand } from './commands/info.js';
import { upgradeCommand } from './commands/upgrade.js';
import { parseFlags } from './flags.js';

const COMMANDS = {
  // lifecycle
  dev: { run: devCommand, aliases: [] },
  build: { run: buildCommand, aliases: [] },
  start: { run: startCommand, aliases: [] },
  // scaffolding
  create: { run: createCommand, aliases: [] },
  generate: { run: generateCommand, aliases: ['g'] },
  delete: { run: deleteCommand, aliases: ['d'] },
  add: { run: addCommand, aliases: [] },
  // introspection
  routes: { run: routesCommand, aliases: [] },
  info: { run: infoCommand, aliases: [] },
  version: { run: versionCommand, aliases: ['v'] },
  // engine / maintenance
  ssg: { run: ssgCommand, aliases: [] },
  upgrade: { run: upgradeCommand, aliases: [] },
};

function resolveCommand(name) {
  if (!name) return undefined;
  for (const [cmd, def] of Object.entries(COMMANDS)) {
    if (cmd === name || def.aliases.includes(name)) return cmd;
  }
  return undefined;
}

export async function dispatch(argv) {
  const [raw, ...rest] = argv;

  if (raw === '--help' || raw === '-h' || raw === 'help' || raw === 'h') {
    printHelp();
    return 0;
  }
  if (raw === '--version' || raw === '-V') {
    return versionCommand([], await buildCtx([]));
  }

  const command = resolveCommand(raw);
  if (!command) {
    console.error(`Unknown command: ${raw || '(none)'}`);
    printHelp();
    return 1;
  }

  const { args, flags } = parseFlags(rest);
  const ctx = await buildCtx(flags);
  const def = COMMANDS[command];
  return def.run(args, ctx);
}

async function buildCtx(flags) {
  return {
    flags,
    cwd: process.cwd(),
    force: flags.force === true || flags.f === true,
    dryRun: flags['dry-run'] === true,
  };
}

function printHelp() {
  console.log(`cossack <command> [args] [options]

Commands:
  create <name>                Scaffold a new Cossack project.
  dev                          Start the dev server (vite dev).
  build                        Production build (vite build && cossack ssg).
  start                        Start the production server.
  generate <type> <name> (g)   Generate page/component/layout/middleware/service.
                               Types: page(p) component(c) layout(l) middleware(m) service(s)
  delete <type> <name>    (d)  Delete a generated file/folder.
  add <feature>                Add a feature (e.g. auth).
  routes                       List all routes in the project.
  upgrade [dir]                Upgrade Cossack deps + report template drift.
  ssg                          Pre-render pages marked ssg:true to static HTML.
  info                         Print system/environment info for bug reports.
  version (v)                  Print the CLI version.

Options:
  --force, -f          Overwrite existing files / skip confirmation.
  --dry-run            Show what would happen without writing.
  --help, -h           Show this help.
  --version, -V        Print the CLI version.

Run \`cossack <command> --help\` for command-specific options.`);
}

export { COMMANDS, printHelp };
