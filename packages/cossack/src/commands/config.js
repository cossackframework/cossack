import { CONFIG_TYPES_PATH, generateConfigTypes } from '@cossackframework/framework/config-codegen';
import { commandSpecs } from '../command-specs.js';
import { findProjectRoot } from '../fs-utils.js';
import { runWithSpec } from '../command-spec.js';
import { inspectConfigurationRequirements } from '../config-inspection.js';

/** Report type origins only; configuration factories and their values stay server-only. */
export async function configCommand(args, ctx) {
  return runWithSpec(commandSpecs.config, args, ctx, async () => {
    const root = await findProjectRoot(ctx.cwd);
    const inspection = await inspectConfigurationRequirements(root, {
      environment: ctx.flags.env ?? process.env.CLOUDFLARE_ENV, check: ctx.flags.check === true,
    });
    const factories = inspection.factories.map(factory => ({ ...factory,
      typeOrigin: { module: factory.source, export: 'default', inference: 'ReturnType' },
    }));
    if (ctx.flags.check === true && !inspection.valid) {
      if (ctx.flags.json !== true) for (const diagnostic of inspection.diagnostics) console.error(`${diagnostic.code}: ${diagnostic.message}`);
      return { exitCode: 1, data: { ...inspection, factories, count: factories.length }, diagnostics: inspection.diagnostics };
    }
    let generation;
    if (ctx.flags.generate === true) {
      const dryRun = ctx.dryRun === true;
      const result = generateConfigTypes(root, { write: !dryRun });
      generation = { file: CONFIG_TYPES_PATH, changed: result.changed, written: !dryRun && result.changed, dryRun };
    }
    if (ctx.flags.json !== true) {
      for (const factory of factories) console.log(`${factory.key}\t${factory.source}\tReturnType<default>`);
      if (!factories.length) console.log('No configuration factories found under src/config/.');
      if (generation) console.log(`${generation.dryRun ? 'Would generate' : generation.changed ? 'Generated' : 'Unchanged'} ${generation.file}`);
    }
    return { ...inspection, factories, count: factories.length, ...(generation ? { generation } : {}) };
  }, configHelp);
}

export function configHelp() {
  return commandSpecs.config.help(`cossack config

List configuration factory filenames and default-export type origins.
Filename discovery does not verify factory exports.
Factories and values are never evaluated or listed.\nUse --check --env <name> to validate declared requirements against selected Wrangler\nvariables and binding kinds. Remote resources and secret availability are not checked.\nProcess and development environment overrides are not inspected.
Use --generate to emit configuration types before a standalone TypeScript check.
The application tsconfig must include .cossack/config.d.ts.`);
}
