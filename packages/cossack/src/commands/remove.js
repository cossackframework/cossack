import {
  FEATURES,
  removeFeatureFromProject,
} from '@cossackframework/scaffold';
import path from 'node:path';
import { findProjectRoot } from '../fs-utils.js';

import { CommandSpec, createCommandOutput, runWithSpec } from '../command-spec.js';

const spec = new CommandSpec({
  name: 'remove',
  positionals: ['feature'],
  minPositionals: 1,
  flags: { yes: { type: 'boolean', aliases: ['y'] } },
});

export async function removeCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
    ctx.out = createCommandOutput(ctx);
    return removeCommandInner(args, ctx);
  });
}

async function removeCommandInner(args, ctx) {
  const [feature] = args;
  if (!feature || !FEATURES.includes(feature)) {
    throw Object.assign(
      new Error(`Unknown feature: ${feature}. Available features: ${FEATURES.join(', ')}`),
      { code: 'COSSACK_FEATURE_UNKNOWN' },
    );
  }

  try {
    const root = await findProjectRoot(ctx.cwd);
    const result = await removeFeatureFromProject(root, feature, {
      force: ctx.force,
      dryRun: ctx.dryRun,
      yes: ctx.flags.yes === true || ctx.flags.y === true,
      interactive: ctx.flags.yes !== true && ctx.flags.y !== true && !ctx.dryRun,
    });

    if (result.status === 'absent') {
      ctx.out.line(`  absent   ${feature} is not installed`);
      return 0;
    }
    if (result.status === 'cancelled') {
      ctx.out.line('Cancelled. No files were changed.');
      return 0;
    }

    for (const change of result.changes.writes) {
      ctx.out.file(result.status === 'dry-run' ? 'planned' : (change.overwrite ? 'overwritten' : 'created'),
        path.join(root, change.path));
    }
    for (const change of result.changes.deletes) {
      ctx.out.file('deleted', path.join(root, change.path));
    }
    ctx.out.line(
      `${result.status === 'dry-run' ? 'Would apply' : 'Applied'} ` +
      `${result.changes.writes.length} write(s) and ` +
      `${result.changes.deletes.length} deletion(s). ` +
      `Resolved features: ${result.recipe.resolvedFeatures.join(', ') || 'minimal'}.`,
    );
    if (result.status !== 'dry-run') {
      ctx.out.line('\nNext: run `pnpm install` to reconcile dependencies.');
    }
    return ctx.out.data({ feature, status: result.status,
      resolvedFeatures: result.recipe.resolvedFeatures });
  } catch (error) {
    if (error?.code === 'COSSACK_PROMPT_ABORTED') return 130;
    console.error(`  error   ${error.message}`);
    return 1;
  }
}

export function removeHelp() {
  return `cossack remove <ui|database|studio|auth|dashboard|markdown|examples>

Remove a feature and any installed features that depend on it. Automatically
added prerequisites are removed when no remaining feature needs them.

Options:
  --yes                Apply without confirmation
  --force              Delete locally modified scaffold-owned files
  --dry-run            Show changes without writing`;
}
