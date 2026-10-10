import { commandSpecs } from '../command-specs.js';
import { runWithSpec } from '../command-spec.js';
import { findProjectRoot } from '../fs-utils.js';
import { readDocumentation } from '../documentation-service.js';

export function docsCommand(args, ctx) {
  return runWithSpec(commandSpecs.docs, args, ctx, async () => {
    const result = await readDocumentation(await findProjectRoot(ctx.cwd), { package: ctx.flags.package, symbols: ctx.flags.symbols, symbol: ctx.flags.symbol });
    if (ctx.flags.json) return { exitCode: result.ok ? 0 : 1, data: result.data, diagnostics: result.diagnostics };
    console.log(result.data.guide.markdown);
    for (const pkg of result.data.packages) {
      console.log(`${pkg.name}: ${pkg.installed ? pkg.version : 'not installed'}`);
      for (const entry of pkg.exports ?? []) console.log(`  ${entry.import} (${entry.targets.map(target => target.status).join(', ')})`);
      if (pkg.implicitEntry) console.log(`  ${pkg.implicitEntry.import} (legacy manifest: ${pkg.implicitEntry.targets.map(target => target.status).join(', ')})`);
    }
    for (const pkg of result.data.packages) for (const guide of pkg.guidance?.guides ?? []) {
      console.log(`\n${pkg.name}@${pkg.version}: ${guide.title}\n${guide.markdown}`);
      for (const example of guide.examples) console.log(`\nExample: ${example.id}\n${example.source}`);
    }
    for (const pkg of result.data.packages) for (const entry of pkg.declarations?.entries ?? []) {
      console.log(`Declarations: ${entry.file} (${entry.sourceKind}, ${entry.status})`);
      if (entry.availableSymbols) console.log(`Public symbols: ${entry.availableSymbols.join(', ')}`);
      for (const symbol of entry.symbols) console.log(`  ${symbol.name}: ${symbol.type ?? symbol.status}`);
    }
    for (const diagnostic of result.diagnostics) console.error(`${diagnostic.code}: ${diagnostic.message}`);
    return result.ok ? 0 : 1;
  });
}
export function docsHelp() {
  return commandSpecs.docs.help(`cossack docs [--package <name>] [--symbols] [--symbol <name>] [--json]

Read offline installed-version export targets, CLI command schemas and agent guidance.
No modules are executed and no files are generated. Use --symbols with one --package to index installed declarations and published TypeScript signatures.
Use --symbol for an exact exported name and a smaller component contract. Filtered entries also list availableSymbols.
Declaration signatures do not prove runtime exports or adapter compatibility.
Package-owned usage guides include example source when available. Discovery never executes it.
Verified runtime guidance remains separate.`);
}
