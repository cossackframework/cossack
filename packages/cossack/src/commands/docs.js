import { commandSpecs } from '../command-specs.js';
import { runWithSpec } from '../command-spec.js';
import { findProjectRoot } from '../fs-utils.js';
import { readDocumentation } from '../documentation-service.js';

export function docsCommand(args, ctx) {
  return runWithSpec(commandSpecs.docs, args, ctx, async () => {
    const result = await readDocumentation(await findProjectRoot(ctx.cwd), { package: ctx.flags.package });
    if (ctx.flags.json) return { exitCode: result.ok ? 0 : 1, data: result.data, diagnostics: result.diagnostics };
    console.log(result.data.guide.markdown);
    for (const pkg of result.data.packages) {
      console.log(`${pkg.name}: ${pkg.installed ? pkg.version : 'not installed'}`);
      for (const entry of pkg.exports ?? []) console.log(`  ${entry.import} (${entry.targets.map(target => target.status).join(', ')})`);
    }
    for (const diagnostic of result.diagnostics) console.error(`${diagnostic.code}: ${diagnostic.message}`);
    return result.ok ? 0 : 1;
  });
}
export function docsHelp() {
  return commandSpecs.docs.help(`cossack docs [--package <name>] [--json]

Read offline installed-version export targets, CLI command schemas and agent guidance.
No modules are executed and no files are generated. Named-symbol indexing, runtime
compatibility and executable examples are not included in this initial catalog.`);
}
