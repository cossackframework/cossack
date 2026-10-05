import { tracesCommand, tracesHelp } from './commands/traces.js';
import { testResultsCommand, testResultsHelp } from './commands/test-results.js';
import { docsCommand, docsHelp } from './commands/docs.js';
import { commandSpecs } from './command-specs.js';
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
import { parseFlags, requestsJSON, requestsHelp } from './flags.js';
import { commandFailure, diagnosticCode, diagnosticMessage, writeResult } from './output.js';
import { deployCommand, deployHelp } from './commands/deploy.js';
import { inspectCommand, inspectHelp, checkCommand, checkHelp } from './commands/inspect.js';

const COMMANDS = {
  // lifecycle
  dev: { run: devCommand, help: devHelp },
  build: { run: buildCommand, help: buildHelp },
  start: { run: startCommand, help: startHelp },
  deploy: { run: deployCommand, help: deployHelp },
  // scaffolding
  create: { run: createCommand, help: createHelp },
  generate: { run: generateCommand, help: generateHelp },
  delete: { run: deleteCommand, help: deleteHelp },
  add: { run: addCommand, help: addHelp },
  remove: { run: removeCommand, help: removeHelp },
  adapter: { run: adapterCommand, help: adapterHelp },
  lang: { run: langCommand, help: langHelp },
  migration: { run: migrationCommand, help: migrationHelp },
  seeder: { run: seederCommand, help: seederHelp },
  schema: { run: schemaCommand, help: schemaHelp },
  studio: { run: studioCommand, help: studioHelp },
  docs: { run: docsCommand, help: docsHelp },
  traces: { run: tracesCommand, help: tracesHelp },
  'test-results': { run: testResultsCommand, help: testResultsHelp },
  // introspection
  inspect: { run: inspectCommand, help: inspectHelp },
  check: { run: checkCommand, help: checkHelp },
  routes: { run: routesCommand, help: routesHelp },
  info: { run: infoCommand, help: infoHelp },
  version: { run: versionCommand, help: versionHelp },
  // engine / maintenance
  ssg: { run: ssgCommand, help: ssgHelp },
  upgrade: { run: upgradeCommand, help: upgradeHelp },
  image: { run: imageCommand, help: imageHelp },
};

for (const [name, definition] of Object.entries(COMMANDS)) {
  definition.spec = commandSpecs[name];
  definition.aliases = definition.spec.aliases;
}

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
    if (requestsJSON(rest)) writeResult('cossack', { data: { help: printHelp(true) } });
    else printHelp();
    return 0;
  }
  if (raw === '--version' || raw === '-V') {
    return dispatch(['version', ...rest]);
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
  if (requestsHelp(rest)) {
    if (requestsJSON(rest)) writeResult(command, { data: { help: def.help() } });
    else console.log(def.help());
    return 0;
  }
  // Preserve the downstream tool's argument syntax and ordering verbatim.
  // Framework parsing otherwise consumes values such as --mode and --port.
  if (def.spec.forwardsArgs) {
    const toolArgs = [];
    let json = false;
    let forwarding = false;
    let environment;
    for (let index = 0; index < rest.length; index++) {
      const argument = rest[index];
      if (argument === '--') forwarding = true;
      if (!forwarding && def.spec.flags?.env && (argument === '--env' || argument.startsWith('--env='))) {
        const value = argument === '--env' ? rest[++index] : argument.slice('--env='.length);
        if (value === undefined || !value.trim() || value.startsWith('-')) {
          return commandFailure({ flags: { json: requestsJSON(rest) } }, command,
            'COSSACK_OPTION_VALUE_REQUIRED', '--env requires a nonempty Cloudflare environment name.');
        }
        if (environment !== undefined) {
          return commandFailure({ flags: { json: requestsJSON(rest) } }, command,
            'COSSACK_OPTION_REPEATED', '--env accepts one Cloudflare environment name.');
        }
        environment = value;
        continue;
      }
      if (!forwarding && (argument === '--json' || argument === '--json=true')) json = true;
      else if (!forwarding && argument === '--json=false') json = false;
      else if (!forwarding && argument.startsWith('--json=')) {
        return commandFailure({ flags: { json: requestsJSON(rest) } }, command,
          'COSSACK_OPTION_INVALID', '--json expects true or false.');
      } else toolArgs.push(argument);
    }
    return def.run(toolArgs, await buildCtx({ json, ...(environment === undefined ? {} : { env: environment }) }));
  }
  let parsed;
  try { parsed = parseFlags(rest, def.spec); }
  catch (error) {
    if (requestsJSON(rest)) {
      writeResult(command, { ok: false, diagnostics: error.diagnostics ?? [{
        code: error.code ?? 'COSSACK_OPTION_INVALID', severity: 'error', message: error.message,
        ...(error.supported ? { supported: error.supported } : {}),
      }] });
      return 1;
    }
    return commandFailure({ flags: { json: requestsJSON(rest) } }, command, error.code ?? 'COSSACK_OPTION_INVALID', error.message);
  }
  const { args, flags } = parsed;
  const ctx = await buildCtx(flags);
  try { return await def.run(args, ctx); }
  catch (error) { return commandFailure(ctx, command, diagnosticCode(error),
    ctx.flags.json === true ? diagnosticMessage(error) : error.message); }
}

async function buildCtx(flags) {
  return {
    flags,
    cwd: process.cwd(),
    force: flags.force === true,
    dryRun: flags['dry-run'] === true,
  };
}

function printHelp(asText = false) {
  const help = `${renderBanner()}

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
  docs                         Read offline installed-version API export and command catalogs.
  traces                       Read recorded development snapshots and timelines.
  test-results                 Read recorded test evidence and source freshness.
  info                         Print system/environment info for bug reports.
  version (v)                  Print the CLI version.

Options:
  --force, -f          Overwrite existing files / skip confirmation.
  --dry-run            Preview command effects (see command-specific help).
  --help, -h           Show this help.
  --version, -V        Print the CLI version.

Run \`cossack <command> --help\` for command-specific options.`;
  if (asText) return help;
  console.log(help);
}

export { COMMANDS, printHelp };
