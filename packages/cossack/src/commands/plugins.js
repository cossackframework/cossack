import path from 'node:path';
import { addPlugin, listPlugins, removePlugin, unrestrictedWarning, upgradePlugin } from '@cossackframework/scaffold/plugins';
import { commandSpecs } from '../command-specs.js';
import { createCommandOutput, runWithSpec } from '../command-spec.js';
import { findProjectRoot } from '../fs-utils.js';
import { flagString } from '../flags.js';
import { COSSACK_PACKAGES, readInstalledPackage } from '../installed-packages.js';
import { ensureWorkerLoader, pluginRuntime, runtimeLine } from '../plugin-isolation.js';
import { formatPolicyDiagnostic, lintProjectPlugins } from '../plugin-policy.js';

const spec = commandSpecs.plugins;

export async function pluginsCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
    ctx.out = createCommandOutput(ctx);
    const [subcommand, name] = args;
    const root = await findProjectRoot(ctx.cwd);
    if (subcommand === 'list') return listCommand(root, ctx);
    if (subcommand === 'upgrade') return renderCommand(root, ctx, async consent => upgradePlugin(root, name, {
      ...options(ctx), ...consent, source: flagString(ctx.flags.source), versions: await installedVersions(root),
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
  return renderCommand(root, ctx, async consent => addPlugin(root, source, { ...options(ctx), ...consent, versions: await installedVersions(root) }), source);
}

async function listCommand(root, ctx) {
  const listed = await listPlugins(root);
  const installed = listed.installed;
  const rendered = [];
  for (const plugin of listed.rendered) {
    const placement = await pluginRuntime(root, plugin.name).catch(() => null);
    rendered.push({ ...plugin, ...(placement ? { runtime: placement.mode, ...(placement.mode === 'app' ? { runtimeReason: placement.reason } : {}) } : {}) });
  }
  if (!rendered.length && !installed.length) ctx.out.line('No plugins are rendered or installed.');
  for (const plugin of rendered) ctx.out.line(`  rendered  ${plugin.name} ${plugin.version} from ${plugin.package} (${plugin.source.type})${plugin.runtime ? ` ${plugin.runtime === 'isolated' ? 'isolated' : 'in app'}` : ''}${plugin.unrestricted ? ' UNRESTRICTED: can do anything' : ''}`);
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
  const isError = diagnostic => diagnostic.severity === 'error';
  const data = ctx.out.data({ plugins: results.map(result => ({ plugin: result.plugin, files: result.files, errors: result.diagnostics.filter(isError).length,
    ...(result.diagnostics.some(diagnostic => diagnostic.code === 'COSSACK_PLUGIN_UNRESTRICTED') ? { unrestricted: true } : {}) })) });
  return diagnostics.some(isError)
    ? { exitCode: 1, data, diagnostics: diagnostics.filter(isError).map(diagnostic => ({ ...diagnostic })) }
    : data;
}

/**
 * Rendering stops at a plugin asking for unrestricted access until someone accepts it: its code
 * can run as soon as the application starts. A terminal asks, defaulting to no; anything else
 * needs --allow-unrestricted, and --yes and --force do not count.
 */
async function renderWithConsent(run, ctx, seen) {
  try { return await run({ allowUnrestricted: ctx.flags['allow-unrestricted'] === true }); }
  catch (error) {
    if (error?.code !== 'COSSACK_PLUGIN_UNRESTRICTED') throw error;
    ctx.out.warn(error.message);
    seen.warning = true;
    if (ctx.flags.json === true || !process.stdin.isTTY || !process.stdout.isTTY) throw error;
    const { default: prompts } = await import('prompts');
    const { accepted } = await prompts({ type: 'confirm', name: 'accepted', message: 'Install this plugin anyway?', initial: false });
    if (accepted !== true) throw error;
    return run({ allowUnrestricted: true });
  }
}

async function renderCommand(root, ctx, run, subject) {
  const seen = { warning: false };
  let result;
  try { result = await renderWithConsent(run, ctx, seen); }
  catch (error) {
    if (error?.code === 'COSSACK_PLUGIN_UNRESTRICTED') {
      const hint = 'Nothing was rendered. Pass --allow-unrestricted to accept this.';
      ctx.out.warn(hint);
      return { exitCode: 1, data: ctx.out.data({ subject, unrestricted: true }), diagnostics: [{ code: error.code, severity: 'error', message: `${error.message} ${hint}` }] };
    }
    if (error?.code === 'COSSACK_PLUGIN_CONFLICT') {
      ctx.out.warn(error.message);
      return { exitCode: 1, data: ctx.out.data({ subject, conflicts: error.conflicts }), diagnostics: [{ code: error.code, severity: 'error', message: error.message, conflicts: error.conflicts }] };
    }
    throw Object.assign(new Error(error.message), { code: error.code ?? 'COSSACK_PLUGIN_FAILED' });
  }
  if (result.unrestricted && !seen.warning) ctx.out.warn(unrestrictedWarning(result.name));
  const planned = result.status === 'dry-run';
  for (const change of result.changes.writes) ctx.out.file(planned ? 'planned' : change.overwrite ? 'overwritten' : 'created', path.join(root, change.path));
  for (const change of result.changes.deletes) ctx.out.file(planned ? 'planned-delete' : 'deleted', path.join(root, change.path));
  for (const change of result.changes.preserved) ctx.out.file('preserved', path.join(root, change.path));
  const dependencies = result.dependencies ?? [];
  if (result.status === 'present') ctx.out.line(`  present   ${result.name} ${result.version} is already rendered`);
  else if (result.status === 'removed') ctx.out.line(`Removed plugin ${result.name}.`);
  else ctx.out.line(`${planned ? 'Would render' : result.status === 'added' ? 'Rendered' : 'Upgraded'} ${result.name} ${result.version}${result.from ? ` (from ${result.from})` : ''} into src/plugins/${result.name}/.`);
  if (dependencies.length && !planned) ctx.out.line(`Added dependencies: ${dependencies.map(change => `${change.name}@${change.to}`).join(', ')}. Run \`pnpm install\`.`);
  // Where its server code will run, and the binding the first isolated plugin needs on Cloudflare.
  const placement = planned || result.status === 'removed' ? null : await pluginRuntime(root, result.name);
  if (placement) ctx.out.line(runtimeLine(result.name, placement));
  let binding = null;
  if (placement?.mode === 'isolated' && placement.server) {
    try {
      binding = await ensureWorkerLoader(root);
      if (binding) {
        ctx.out.file('updated', binding);
        ctx.out.line(`Added the Worker Loader binding (LOADER) to ${path.relative(root, binding)}. Dynamic Workers need the Workers Paid plan; add the plugin with --in-app to keep it in the application instead.`);
      }
    } catch (error) { ctx.out.warn(error.message); }
  }
  return ctx.out.data({
    name: result.name, status: result.status,
    ...(result.version ? { version: result.version, package: result.package, from: result.from } : {}),
    ...(result.unrestricted ? { unrestricted: true } : {}),
    ...(placement ? { runtime: placement.mode, ...(placement.mode === 'app' ? { runtimeReason: placement.reason } : {}) } : {}),
    ...(binding ? { workerLoader: path.relative(root, binding) } : {}),
    preserved: result.changes.preserved.map(change => change.path),
    dependencies,
    nextActions: !planned && dependencies.length ? ['pnpm install'] : [],
  });
}

function options(ctx) {
  return { force: ctx.force, dryRun: ctx.dryRun, ...(ctx.flags['in-app'] === true ? { inApp: true } : {}) };
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
  check [name]       Policy lints: no raw RomeQL, no undeclared network hosts,
                     permissions, resources or hooks, no host secrets. Builds
                     with the cms feature run the same checks. A plugin with
                     permissions.unrestricted skips them and gets a warning.
  upgrade <name>     Re-render from the recorded source, or from --source.
                     Files you edited are kept; an edited file that also
                     changed upstream is a conflict unless you pass --force.
  remove <name>      Delete the plugin's unedited files.

On Cloudflare, a plugin with only server code runs isolated: a Worker of its
own, reaching only what it is granted. The first one adds the Worker Loader
binding (LOADER, Workers Paid) to wrangler.jsonc; --in-app keeps a plugin in
the application instead. A plugin with pages, UI or templates, and every
plugin on Node.js, runs in the application, where its permissions are
checked at build, not enforced. \`list\` shows which.

A plugin that asks for unrestricted access can do anything in the application,
and its code can run as soon as the application starts. Rendering it stops
with a danger message: a terminal asks, and anything else needs
--allow-unrestricted.

.cossack/plugins.json records each plugin's source and file hashes.`);
}
