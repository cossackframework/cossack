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
import { renderBanner } from './banner.js';
import { deleteCommand } from './commands/delete.js';
import { createCommand } from './commands/create.js';
import { ssgCommand } from './commands/ssg.js';
import { addCommand } from './commands/add.js';
import { removeCommand } from './commands/remove.js';
import { langCommand } from './commands/lang.js';
import { migrationCommand } from './commands/migration.js';
import { seederCommand } from './commands/seeder.js';
import { devCommand } from './commands/dev.js';
import { buildCommand } from './commands/build.js';
import { startCommand } from './commands/start.js';
import { infoCommand } from './commands/info.js';
import { upgradeCommand } from './commands/upgrade.js';
import { imageCommand } from './commands/image.js';
import { adapterCommand } from './commands/adapter.js';
import { studioCommand } from './commands/studio.js';
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
  remove: { run: removeCommand, aliases: [] },
  adapter: { run: adapterCommand, aliases: [] },
  lang: { run: langCommand, aliases: [] },
  migration: { run: migrationCommand, aliases: ['migrate'] },
  seeder: { run: seederCommand, aliases: ['seed'] },
  studio: { run: studioCommand, aliases: [] },
  // introspection
  routes: { run: routesCommand, aliases: [] },
  info: { run: infoCommand, aliases: [] },
  version: { run: versionCommand, aliases: ['v'] },
  // engine / maintenance
  ssg: { run: ssgCommand, aliases: [] },
  upgrade: { run: upgradeCommand, aliases: [] },
  image: { run: imageCommand, aliases: [] },
};

function resolveCommand(name) {
  if (!name) return undefined;
  for (const [cmd, def] of Object.entries(COMMANDS)) {
    if (cmd === name || def.aliases.includes(name)) return cmd;
  }
  return undefined;
}

export async function dispatch(argv) {
  let [raw, ...rest] = argv;

  if (raw === '--help' || raw === '-h' || raw === 'help' || raw === 'h') {
    printHelp();
    return 0;
  }
  if (raw === '--version' || raw === '-V') {
    return versionCommand([], await buildCtx([]));
  }

  // Support colon-joined form for namespaced commands: `cossack image:optimize`
  // is equivalent to `cossack image optimize`. The first segment must resolve
  // to a registered command; the remainder becomes the first positional arg.
  if (raw && raw.includes(':')) {
    const [head, ...tail] = raw.split(':');
    if (resolveCommand(head)) {
      raw = head;
      rest = [...tail, ...rest];
    }
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
  console.log(`${renderBanner()}

cossack <command> [args] [options]

Commands:
  create <name>                Scaffold a new Cossack project.
  dev                          Start the dev server (vite dev).
  build                        Production build (vite build && cossack ssg).
  start                        Start the production server.
  generate <type> <name> (g)   Generate page/component/layout/middleware/service/model/migration/seeder.
                               Types: page(p) component(c) layout(l) middleware(m) service(s)
                                      model migration seeder
  delete <type> <name>    (d)  Delete a generated file/folder.
  add <feature>                Add a feature (ui, database, auth, dashboard, markdown, examples).
  remove <feature>             Remove a feature and its dependents.
  adapter <node|cloudflare>    Switch the active runtime adapter.
  lang <subcommand>            Manage localization catalogs under src/lang/.
                               Subcommands: publish, add <locale>.
  migration <sub> (migrate)    Run Kysely migrations under src/migrations/.
                               Subcommands: up, down, status.
  seeder <sub> (seed)          Run seeders under src/seeders/. Subcommands: run.
  studio                       Inspect the configured database in a local browser.
  routes                       List all routes in the project.
  upgrade [dir]                Upgrade Cossack deps + report template drift.
  ssg                          Pre-render pages marked ssg:true to static HTML.
  image <subcommand>           Image tooling. Subcommands: optimize.
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
