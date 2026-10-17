import path from 'node:path';
import { addPlugin, listPlugins, removePlugin, upgradePlugin } from '@cossackframework/scaffold/plugins';
import { commandSpecs } from '../command-specs.js';
import { createCommandOutput, runWithSpec } from '../command-spec.js';
import { findProjectRoot } from '../fs-utils.js';
import { flagString } from '../flags.js';
import { COSSACK_PACKAGES, readInstalledPackage } from '../installed-packages.js';
import { formatPolicyDiagnostic, lintProjectPlugins } from '../plugin-policy.js';

const spec = commandSpecs.plugins;

export async function pluginsCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
    ctx.out = createCommandOutput(ctx);
    const [subcommand, name] = args;
    const root = await findProjectRoot(ctx.cwd);
    if (subcommand === 'list') return listCommand(root, ctx);
    if (subcommand === 'upgrade') return renderCommand(root, ctx, async () => upgradePlugin(root, name, {
      ...options(ctx), source: flagString(ctx.flags.source), versions: await installedVersions(root),
    }), name);
    if (subcommand === 'remove') return renderCommand(root, ctx, () => removePlugin(root, name, options(ctx)), name);
    if (subcommand === 'check') return checkCommand(root, ctx, name);
    throw Object.assign(new Error(`Unknown plugins subcommand: ${subcommand}. Use list, check, upgrade or remove.`), { code: 'COSSACK_COMMAND_UNKNOWN' });
  });
}

/** `cossack add plugin <source>`: render a plugin package directory, tarball or npm package. */
export async function addPluginCommand(source, ctx) {
  ctx.out ??= createCommandOutput(ctx);
  if (!source) throw Object.assign(new Error('Name a plugin package directory, .tgz tarball or npm package.'), { code: 'COSSACK_ARGUMENT_MISSING' });
  const root = await findProjectRoot(ctx.cwd);
  return renderCommand(root, ctx, async () => addPlugin(root, source, { ...options(ctx), versions: await installedVersions(root) }), source);
}

async function listCommand(root, ctx) {
  const { rendered, installed } = await listPlugins(root);
  if (!rendered.length && !installed.length) ctx.out.line('No plugins are rendered or installed.');
  for (const plugin of rendered) ctx.out.line(`  rendered  ${plugin.name} ${plugin.version} from ${plugin.package} (${plugin.source.type})`);
  for (const plugin of installed.filter(entry => !entry.rendered)) {
    ctx.out.line(`  installed ${plugin.package} ${plugin.version}${plugin.problems.length ? ` (invalid: ${plugin.problems.join(' ')})` : ` — render with cossack add plugin ${plugin.package}`}`);
  }
  return ctx.out.data({ rendered, installed });
}

/** Policy lints for rendered plugins: the same checks the build runs. */
async function checkCommand(root, ctx, only) {
  const results = await lintProjectPlugins(root, only ? { only } : {});
  if (only && !results.length) throw Object.assign(new Error(`No rendered plugin named "${only}".`), { code: 'COSSACK_PLUGIN_UNKNOWN' });
  const diagnostics = results.flatMap(result => result.diagnostics);
  for (const diagnostic of diagnostics) ctx.out.warn(formatPolicyDiagnostic(diagnostic));
  ctx.out.line(`Checked ${results.length} plugin(s), ${results.reduce((total, result) => total + result.files, 0)} file(s): ${diagnostics.length} problem(s).`);
  const data = ctx.out.data({ plugins: results.map(result => ({ plugin: result.plugin, files: result.files, errors: result.diagnostics.length })) });
  return diagnostics.length
    ? { exitCode: 1, data, diagnostics: diagnostics.map(diagnostic => ({ ...diagnostic })) }
    : data;
}

async function renderCommand(root, ctx, run, subject) {
  let result;
  try { result = await run(); }
  catch (error) {
    if (error?.code === 'COSSACK_PLUGIN_CONFLICT') {
      ctx.out.warn(error.message);
      return { exitCode: 1, data: ctx.out.data({ subject, conflicts: error.conflicts }), diagnostics: [{ code: error.code, severity: 'error', message: error.message, conflicts: error.conflicts }] };
    }
    throw Object.assign(new Error(error.message), { code: error.code ?? 'COSSACK_PLUGIN_FAILED' });
  }
  const planned = result.status === 'dry-run';
  for (const change of result.changes.writes) ctx.out.file(planned ? 'planned' : change.overwrite ? 'overwritten' : 'created', path.join(root, change.path));
  for (const change of result.changes.deletes) ctx.out.file(planned ? 'planned-delete' : 'deleted', path.join(root, change.path));
  for (const change of result.changes.preserved) ctx.out.file('preserved', path.join(root, change.path));
  const dependencies = result.dependencies ?? [];
  if (result.status === 'present') ctx.out.line(`  present   ${result.name} ${result.version} is already rendered`);
  else if (result.status === 'removed') ctx.out.line(`Removed plugin ${result.name}.`);
  else ctx.out.line(`${planned ? 'Would render' : result.status === 'added' ? 'Rendered' : 'Upgraded'} ${result.name} ${result.version}${result.from ? ` (from ${result.from})` : ''} into src/plugins/${result.name}/.`);
  if (dependencies.length && !planned) ctx.out.line(`Added dependencies: ${dependencies.map(change => `${change.name}@${change.to}`).join(', ')}. Run \`pnpm install\`.`);
  return ctx.out.data({
    name: result.name, status: result.status,
    ...(result.version ? { version: result.version, package: result.package, from: result.from } : {}),
    preserved: result.changes.preserved.map(change => change.path),
    dependencies,
    nextActions: !planned && dependencies.length ? ['pnpm install'] : [],
  });
}

function options(ctx) {
  return { force: ctx.force, dryRun: ctx.dryRun };
}

/** Installed Cossack package versions, read from manifests only, for compatibility ranges. */
async function installedVersions(root) {
  const versions = {};
  for (const name of COSSACK_PACKAGES) {
    const installed = await readInstalledPackage(root, name).catch(() => null);
    if (installed) versions[name] = installed.manifest.version;
  }
  return versions;
}

export function pluginsHelp() {
  return commandSpecs.plugins.help(`cossack plugins <list|check|upgrade|remove> [name]

Manage plugins rendered into src/plugins/<name>/. Render one with
\`cossack add plugin <directory|tarball.tgz|npm-package>\`. Plugin packages are
read as data and never executed; npm installs run with --ignore-scripts.

  list               Rendered plugins, and installed packages that declare
                     package.json#cossack.plugin but are not rendered yet.
  check [name]       Policy lints: no raw FastQL, no undeclared network hosts,
                     permissions, resources or hooks, no host secrets. Builds
                     with the cms feature run the same checks.
  upgrade <name>     Re-render from the recorded source, or from --source.
                     Files you edited are kept; an edited file that also
                     changed upstream is a conflict unless you pass --force.
  remove <name>      Delete the plugin's unedited files.

.cossack/plugins.json records each plugin's source and file hashes.`);
}
