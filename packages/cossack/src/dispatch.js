/**
 * Command resolution + top-level dispatch.
 *
 * Each command module exports `async function run(args, ctx): Promise<number>`
 * where `args` is the remaining argv after the command/subcommand and `ctx`
 * holds shared flags. Returns a process exit code.
 *
 * Command modules are imported lazily on dispatch so that cheap commands
 * (`version`, `--help`, option validation) never pay for loading Vite, the
 * TypeScript compiler, scaffold recipes or provider SDKs.
 */
import { commandSpecs } from './command-specs.js';
import { FEATURES } from '@cossackframework/scaffold/registry';
import { renderBanner } from './banner.js';
import { parseFlags, requestsJSON, requestsHelp } from './flags.js';
import { commandFailure, diagnosticCode, diagnosticMessage, writeResult } from './output.js';

/** name -> [module loader, run export, help export] */
const LOADERS = {
  // lifecycle
  dev: [() => import('./commands/dev.js'), 'devCommand', 'devHelp'],
  build: [() => import('./commands/build.js'), 'buildCommand', 'buildHelp'],
  start: [() => import('./commands/start.js'), 'startCommand', 'startHelp'],
  deploy: [() => import('./commands/deploy.js'), 'deployCommand', 'deployHelp'],
  preview: [() => import('./commands/preview.js'), 'previewCommand', 'previewHelp'],
  resources: [() => import('./commands/resources.js'), 'resourcesCommand', 'resourcesHelp'],
  // scaffolding
  create: [() => import('./commands/create.js'), 'createCommand', 'createHelp'],
  generate: [() => import('./commands/generate.js'), 'generateCommand', 'generateHelp'],
  delete: [() => import('./commands/delete.js'), 'deleteCommand', 'deleteHelp'],
  add: [() => import('./commands/add.js'), 'addCommand', 'addHelp'],
  remove: [() => import('./commands/remove.js'), 'removeCommand', 'removeHelp'],
  adapter: [() => import('./commands/adapter.js'), 'adapterCommand', 'adapterHelp'],
  lang: [() => import('./commands/lang.js'), 'langCommand', 'langHelp'],
  migration: [() => import('./commands/migration.js'), 'migrationCommand', 'migrationHelp'],
  seeder: [() => import('./commands/seeder.js'), 'seederCommand', 'seederHelp'],
  schema: [() => import('./commands/schema.js'), 'schemaCommand', 'schemaHelp'],
  studio: [() => import('./commands/studio.js'), 'studioCommand', 'studioHelp'],
  docs: [() => import('./commands/docs.js'), 'docsCommand', 'docsHelp'],
  traces: [() => import('./commands/traces.js'), 'tracesCommand', 'tracesHelp'],
  'test-results': [() => import('./commands/test-results.js'), 'testResultsCommand', 'testResultsHelp'],
  // introspection
  inspect: [() => import('./commands/inspect.js'), 'inspectCommand', 'inspectHelp'],
  check: [() => import('./commands/inspect.js'), 'checkCommand', 'checkHelp'],
  routes: [() => import('./commands/routes.js'), 'routesCommand', 'routesHelp'],
  config: [() => import('./commands/config.js'), 'configCommand', 'configHelp'],
  info: [() => import('./commands/info.js'), 'infoCommand', 'infoHelp'],
  version: [() => import('./commands/version.js'), 'versionCommand', 'versionHelp'],
  // engine / maintenance
  ssg: [() => import('./commands/ssg.js'), 'ssgCommand', 'ssgHelp'],
  upgrade: [() => import('./commands/upgrade.js'), 'upgradeCommand', 'upgradeHelp'],
  image: [() => import('./commands/image.js'), 'imageCommand', 'imageHelp'],
};

/**
 * Registry of commands. `load()` imports the command module once and resolves
 * to a stable `{ run, help }` object (stable so tests can spy on it).
 */
const COMMANDS = {};
for (const [name, [importModule, runName, helpName]] of Object.entries(LOADERS)) {
  const spec = commandSpecs[name];
  let loaded;
  COMMANDS[name] = {
    spec,
    aliases: spec.aliases,
    load() {
      loaded ??= importModule().then(mod => ({ run: mod[runName], help: mod[helpName] }));
      return loaded;
    },
  };
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
    const loaded = await def.load();
    if (requestsJSON(rest)) writeResult(command, { data: { help: loaded.help() } });
    else console.log(loaded.help());
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
    const loaded = await def.load();
    return loaded.run(toolArgs, await buildCtx({ json, ...(environment === undefined ? {} : { env: environment }) }));
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
  try { return await (await def.load()).run(args, ctx); }
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

/** Wrap a comma-separated list into help-column lines. */
function wrapList(items, indent, width = 79) {
  const lines = [];
  let line = '';
  for (const [index, item] of items.entries()) {
    const word = item + (index < items.length - 1 ? ',' : '.');
    if (line && indent + line.length + 1 + word.length > width) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.map(entry => ' '.repeat(indent) + entry).join('\n');
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
  preview <create|inspect|cleanup> Native isolated previews and verified cleanup.
  resources <plan|apply>        Select account-owned bindings (--account, --env, --select, --verify).
  inspect cloudflare           Show resolved Cloudflare configuration (--env, --json).
  check cloudflare             Validate local Cloudflare configuration without writes.
  generate <type> <name> (g)   Generate page/component/layout/middleware/service/model/migration/seeder.
                               Types: page(p) component(c) layout(l) middleware(m) service(s)
                                      model migration seeder
  delete <type> <name>    (d)  Delete a generated file/folder.
  add <feature>                Add a feature and its prerequisites. Features:
${wrapList(FEATURES, 31)}
  remove <feature>             Remove a feature and its dependents.
  adapter <node|cloudflare>    Switch the active runtime adapter.
  lang <subcommand>            Manage localization catalogs under src/lang/.
                               Subcommands: publish, add <locale>, extract, check, types.
  migration <sub> (migrate)    Run ORM migrations. Subcommands: generate, snapshot,
                               squash, up, down, status, rehash, check, baseline, plan.
  schema <sub>                 ORM schema commands: inspect, pull, diff, check.
  seeder <sub> (seed)          Run registered ORM seeders: list, run.
  studio                       Inspect the configured database in a local browser.
  routes                       List all routes in the project.
  config                       List configuration factory type origins; --generate emits types.
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
