/**
 * Command resolution + top-level dispatch.
 *
 * Each command module exports `async function run(args, ctx): Promise<number>`
 * where `args` is the remaining argv after the command/subcommand and `ctx`
 * holds shared flags. Returns a process exit code.
 */
import { versionCommand, versionHelp } from './commands/version.js';
import { routesCommand, routesHelp } from './commands/routes.js';
import { generateCommand, generateHelp } from './commands/generate.js';
import { renderBanner } from './banner.js';
import { deleteCommand, deleteHelp } from './commands/delete.js';
import { createCommand, createHelp } from './commands/create.js';
import { ssgCommand, ssgHelp } from './commands/ssg.js';
import { addCommand, addHelp } from './commands/add.js';
import { removeCommand, removeHelp } from './commands/remove.js';
import { langCommand, langHelp } from './commands/lang.js';
import { migrationCommand, migrationHelp } from './commands/migration.js';
import { seederCommand, seederHelp } from './commands/seeder.js';
import { schemaCommand, schemaHelp } from './commands/schema.js';
import { devCommand, devHelp } from './commands/dev.js';
import { buildCommand, buildHelp } from './commands/build.js';
import { startCommand, startHelp } from './commands/start.js';
import { infoCommand, infoHelp } from './commands/info.js';
import { upgradeCommand, upgradeHelp } from './commands/upgrade.js';
import { imageCommand, imageHelp } from './commands/image.js';
import { adapterCommand, adapterHelp } from './commands/adapter.js';
import { studioCommand, studioHelp } from './commands/studio.js';
import { parseFlags, requestsJSON } from './flags.js';
import { commandFailure, writeResult } from './output.js';
import { deployCommand, deployHelp } from './commands/deploy.js';
import { inspectCommand, inspectHelp, checkCommand, checkHelp } from './commands/inspect.js';

const COMMANDS = {
  // lifecycle
  dev: { run: devCommand, help: devHelp, aliases: [] },
  build: { run: buildCommand, help: buildHelp, aliases: [] },
  start: { run: startCommand, help: startHelp, aliases: [] },
  deploy: { run: deployCommand, help: deployHelp, aliases: [] },
  // scaffolding
  create: { run: createCommand, help: createHelp, aliases: [] },
  generate: { run: generateCommand, help: generateHelp, aliases: ['g'] },
  delete: { run: deleteCommand, help: deleteHelp, aliases: ['d'] },
  add: { run: addCommand, help: addHelp, aliases: [] },
  remove: { run: removeCommand, help: removeHelp, aliases: [] },
  adapter: { run: adapterCommand, help: adapterHelp, aliases: [] },
  lang: { run: langCommand, help: langHelp, aliases: [] },
  migration: { run: migrationCommand, help: migrationHelp, aliases: ['migrate'] },
  seeder: { run: seederCommand, help: seederHelp, aliases: ['seed'] },
  schema: { run: schemaCommand, help: schemaHelp, aliases: [] },
  studio: { run: studioCommand, help: studioHelp, aliases: [] },
  // introspection
  inspect: { run: inspectCommand, help: inspectHelp, aliases: [] },
  check: { run: checkCommand, help: checkHelp, aliases: [] },
  routes: { run: routesCommand, help: routesHelp, aliases: [] },
  info: { run: infoCommand, help: infoHelp, aliases: [] },
  version: { run: versionCommand, help: versionHelp, aliases: ['v'] },
  // engine / maintenance
  ssg: { run: ssgCommand, help: ssgHelp, aliases: [] },
  upgrade: { run: upgradeCommand, help: upgradeHelp, aliases: [] },
  image: { run: imageCommand, help: imageHelp, aliases: [] },
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
    if (requestsJSON(rest)) {
      return commandFailure({ flags: { json: true } }, raw ?? 'cossack', 'COSSACK_COMMAND_UNKNOWN',
        `Unknown command: ${raw || '(none)'}. Run cossack --help.`);
    }
    console.error(`Unknown command: ${raw || '(none)'}`);
    printHelp();
    return 1;
  }

  const def = COMMANDS[command];
  const optionEnd = rest.indexOf('--');
  const options = optionEnd === -1 ? rest : rest.slice(0, optionEnd);
  if (options.includes('--help') || options.includes('-h')) {
    if (requestsJSON(rest)) writeResult(command, { data: { help: def.help() } });
    else console.log(def.help());
    return 0;
  }
  // Preserve the downstream tool's argument syntax and ordering verbatim.
  // Framework parsing otherwise consumes values such as --mode and --port.
  if (['dev', 'build', 'start', 'ssg'].includes(command)) {
    const toolArgs = [];
    let json = false;
    let forwarding = false;
    for (const argument of rest) {
      if (argument === '--') forwarding = true;
      if (!forwarding && (argument === '--json' || argument === '--json=true')) json = true;
      else if (!forwarding && argument === '--json=false') json = false;
      else if (!forwarding && argument.startsWith('--json=')) {
        return commandFailure({ flags: { json: requestsJSON(rest) } }, command,
          'COSSACK_OPTION_INVALID', '--json expects true or false.');
      } else toolArgs.push(argument);
    }
    return def.run(toolArgs, await buildCtx({ json }));
  }
  let parsed;
  try { parsed = parseFlags(rest); }
  catch (error) {
    return commandFailure({ flags: { json: requestsJSON(rest) } }, command, 'COSSACK_OPTION_INVALID', error.message);
  }
  const { args, flags } = parsed;
  const ctx = await buildCtx(flags);
  try { return await def.run(args, ctx); }
  catch (error) { return commandFailure(ctx, command, error.code ?? 'COSSACK_COMMAND_FAILED', error.message); }
}

async function buildCtx(flags) {
  return {
    flags,
    cwd: process.cwd(),
    force: flags.force === true,
    dryRun: flags['dry-run'] === true,
  };
}

function printHelp() {
  console.log(`${renderBanner()}

cossack <command> [args] [options]

Commands:
  create <name>                Scaffold a new Cossack project.
  dev                          Start the dev server (vite dev).
  build                        Production build, including SSG (vite build).
  start                        Start the production server.
  deploy                       Build and deploy to Cloudflare (--env, --dry-run, --json).
  inspect cloudflare           Show resolved Cloudflare configuration (--env, --json).
  check cloudflare             Validate local Cloudflare configuration without writes.
  generate <type> <name> (g)   Generate page/component/layout/middleware/service/model/migration/seeder.
                               Types: page(p) component(c) layout(l) middleware(m) service(s)
                                      model migration seeder
  delete <type> <name>    (d)  Delete a generated file/folder.
  add <feature>                Add a feature (ui, database, studio, auth, dashboard, markdown, examples).
  remove <feature>             Remove a feature and its dependents.
  adapter <node|cloudflare|deno> Switch the active runtime adapter.
  lang <subcommand>            Manage localization catalogs under src/lang/.
                               Subcommands: publish, add <locale>.
  migration <sub> (migrate)    Run ORM migrations. Subcommands: generate, snapshot,
                               squash, up, down, status, check, baseline, plan.
  schema <sub>                 ORM schema commands: pull, diff, check.
  seeder <sub> (seed)          Run registered ORM seeders: list, run.
  studio                       Inspect the configured database in a local browser.
  routes                       List all routes in the project.
  upgrade [dir]                Upgrade Cossack deps + report template drift.
  ssg                          Pre-render pages marked ssg:true to static HTML.
  image <subcommand>           Image tooling. Subcommands: optimize.
  info                         Print system/environment info for bug reports.
  version (v)                  Print the CLI version.

Options:
  --force, -f          Overwrite existing files / skip confirmation.
  --dry-run            Preview command effects (see command-specific help).
  --help, -h           Show this help.
  --version, -V        Print the CLI version.

Run \`cossack <command> --help\` for command-specific options.`);
}

export { COMMANDS, printHelp };
