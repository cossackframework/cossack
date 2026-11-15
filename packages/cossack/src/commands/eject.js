import { commandSpecs } from '../command-specs.js';
import { runWithSpec, createCommandOutput } from '../command-spec.js';
import { findProjectRoot } from '../fs-utils.js';
import { diffEjected, ejectFiles, resolveEjectTarget, restoreEjected } from '../eject.js';

const spec = commandSpecs.eject;

export async function ejectCommand(args, ctx) {
  ctx.out ??= createCommandOutput(ctx);
  return runWithSpec(spec, args, ctx, async () => {
    const root = await findProjectRoot(ctx.cwd);
    if (ctx.flags.restore === true || ctx.flags.diff === true) {
      // One argument names the copy; with two, the first is the package and is not needed.
      const target = args[1] ?? args[0];
      if (ctx.flags.diff === true) {
        const diffs = await diffEjected(root, target);
        for (const entry of diffs) {
          ctx.out.line(`${entry.file} (${entry.package} ${entry.from}${entry.to && entry.to !== entry.from ? ` -> ${entry.to}` : ''})`);
          if (entry.problem) { ctx.out.line(`  ${entry.problem}`); continue; }
          ctx.out.line(`--- what ${entry.package} changed since the copy was made`);
          ctx.out.line(entry.package_changes || '(nothing)');
          ctx.out.line('--- what this project changed in the copy');
          ctx.out.line(entry.project_changes || '(nothing)');
        }
        return ctx.out.data({ status: 'diff', files: diffs });
      }
      const restored = await restoreEjected(root, target, { force: ctx.force === true, dryRun: ctx.dryRun === true });
      for (const file of restored.files) ctx.out.line(`${restored.dryRun ? 'Would delete' : 'Deleted'} ${file}; the package's file is served again.`);
      return ctx.out.data({ status: restored.dryRun ? 'dry-run' : 'restored', files: restored.files });
    }
    const target = await resolveEjectTarget(root, args[0], args[1]);
    const result = await ejectFiles(root, target, { force: ctx.force === true, dryRun: ctx.dryRun === true });
    const name = target.mounted.name;
    for (const file of result.files) ctx.out.line(`${result.dryRun ? 'Would copy' : 'Copied'} ${file} from ${name}.`);
    if (!result.dryRun) {
      ctx.out.line(target.kind === 'plugin'
        ? `\nsrc/${target.unit.slice(0, -1)} now replaces the plugin that ${name} serves, as a whole.`
        : `\n${result.files[0]} now overrides ${name}'s file.`);
      ctx.out.line('cossack upgrade merges the package\'s later changes into the copy. cossack eject --restore <path> removes it.');
      if (target.kind === 'plugin') ctx.out.line('To change a theme and keep receiving its fixes, a child theme is the better way ("theme": { "extends": "<name>" }).');
    }
    return ctx.out.data({ status: result.dryRun ? 'dry-run' : 'ejected', package: name, version: target.mounted.version, kind: target.kind, files: result.files });
  }, ejectHelp);
}

export function ejectHelp() {
  return commandSpecs.eject.help(`cossack eject <package> <path>
cossack eject --restore <path>
cossack eject --diff <path>

Copy a file that a mounted package serves into the project, where it overrides
the package's file. <package> is the package's name or its short name (cms).
<path> is an application path (src/pages/(site)/search/index.ts), a route
(/search), or a served plugin (plugins/default-theme), which is copied whole.

Only pages, layouts, loading states, configuration files and plugins can be
ejected. The copy is recorded, and cossack upgrade merges the package's later
changes into it. An ejected file stops receiving fixes it conflicts with, so
prefer a plugin, the project's configuration or a child theme where one works.

--restore deletes the copy and its record; the package's file is served again.
--diff shows what the package and the project each changed since the copy.`);
}
