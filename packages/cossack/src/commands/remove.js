import {
  FEATURES,
  removeFeatureFromProject,
} from '@cossackframework/scaffold';
import { findProjectRoot } from '../fs-utils.js';

export async function removeCommand(args, ctx) {
  const [feature] = args;
  if (!feature || !FEATURES.includes(feature)) {
    console.error(
      `Unknown feature: ${feature || '(none)'}.\nAvailable features: ${FEATURES.join(', ')}`,
    );
    return 1;
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
      console.log(`  absent   ${feature} is not installed`);
      return 0;
    }
    if (result.status === 'cancelled') {
      console.log('Cancelled. No files were changed.');
      return 0;
    }

    console.log(
      `${result.status === 'dry-run' ? 'Would apply' : 'Applied'} ` +
      `${result.changes.writes.length} write(s) and ` +
      `${result.changes.deletes.length} deletion(s). ` +
      `Resolved features: ${result.recipe.resolvedFeatures.join(', ') || 'minimal'}.`,
    );
    if (result.status !== 'dry-run') {
      console.log('\nNext: run `pnpm install` to reconcile dependencies.');
    }
    return 0;
  } catch (error) {
    if (error?.code === 'COSSACK_PROMPT_ABORTED') return 130;
    console.error(`  error   ${error.message}`);
    return 1;
  }
}

export function removeHelp() {
  return `cossack remove <ui|database|studio|auth|dashboard|examples>

Remove a feature and any installed features that depend on it. Automatically
added prerequisites are removed when no remaining feature needs them.

Options:
  --yes                Apply without confirmation
  --force              Delete locally modified scaffold-owned files
  --dry-run            Show changes without writing`;
}
