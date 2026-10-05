import { CONFIG_TYPES_PATH, discoverConfigFactories, generateConfigTypes } from '@cossackframework/framework/config-codegen';
import { commandSpecs } from '../command-specs.js';
import { findProjectRoot } from '../fs-utils.js';
import { runWithSpec } from '../command-spec.js';

/** Report type origins only; configuration factories and their values stay server-only. */
export async function configCommand(args, ctx) {
  return runWithSpec(commandSpecs.config, args, ctx, async () => {
    const root = await findProjectRoot(ctx.cwd);
    const factories = discoverConfigFactories(root).map(file => ({
      key: file.slice(0, -3),
      source: `src/config/${file}`,
      typeOrigin: { module: `src/config/${file}`, export: 'default', inference: 'ReturnType' },
    }));
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
    return { factories, count: factories.length, evaluation: 'not-performed', validation: 'not-performed', ...(generation ? { generation } : {}) };
  }, configHelp);
}

export function configHelp() {
  return commandSpecs.config.help(`cossack config

List configuration factory filenames and default-export type origins.
Filename discovery does not verify factory exports.
This does not evaluate factories, list values, or validate required environment variables.
Use --generate to emit configuration types before a standalone TypeScript check.
The application tsconfig must include .cossack/config.d.ts.`);
}
