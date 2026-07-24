import { addFeature, FEATURES, parseList } from '@cossackframework/scaffold';
import { findProjectRoot } from '../fs-utils.js';
import { flagString } from '../flags.js';

export async function addCommand(args, ctx) {
  const [feature] = args;
  if (!feature || !FEATURES.includes(feature)) {
    console.error(
      `Unknown feature: ${feature || '(none)'}.\nAvailable features: ${FEATURES.join(', ')}`,
    );
    return 1;
  }

  try {
    const root = await findProjectRoot(ctx.cwd);
    const result = await addFeature(root, feature, {
      database: flagString(ctx.flags.database) ?? flagString(ctx.flags.dialect),
      runtime: flagString(ctx.flags.runtime),
      authMethods: ctx.flags['auth-methods'],
      oauth: ctx.flags.oauth,
      theme: flagString(ctx.flags.theme),
      features: feature === 'dashboard' && ctx.flags.features !== undefined
        ? parseList(ctx.flags.features)
        : undefined,
      force: ctx.force,
      dryRun: ctx.dryRun,
      yes: ctx.flags.yes === true || ctx.flags.y === true,
      interactive: ctx.flags.yes !== true && ctx.flags.y !== true && !ctx.dryRun,
    });

    if (result.status === 'present') {
      console.log(`  present  ${feature} is already installed`);
      return 0;
    }
    if (result.status === 'cancelled') {
      console.log('Cancelled. No files were changed.');
      return 0;
    }

    const automaticallyAdded = result.addedFeatures.filter(
      (item) => item !== feature,
    );
    console.log(
      `${result.status === 'dry-run' ? 'Would apply' : 'Applied'} ${result.changes.writes.length} write(s)` +
      (result.changes.deletes.length ? ` and ${result.changes.deletes.length} deletion(s)` : '') +
      `. Resolved features: ${result.recipe.resolvedFeatures.join(', ') || 'minimal'}.`,
    );
    if (automaticallyAdded.length) {
      console.log(`Included prerequisites: ${automaticallyAdded.join(', ')}`);
    }
    if (feature === 'dashboard') {
      console.log(`Dashboard modules: ${result.recipe.dashboardModules.join(', ') || '(none)'}`);
    }
    if (result.status !== 'dry-run') {
      console.log('\nNext: run `pnpm install`.' +
        (result.recipe.resolvedFeatures.includes('database')
          ? '\nThen apply migrations with `cossack migration up`.'
          : ''));
    }
    return 0;
  } catch (error) {
    if (error?.code === 'COSSACK_PROMPT_ABORTED') return 130;
    console.error(`  error   ${error.message}`);
    return 1;
  }
}

export function addHelp() {
  return `cossack add <ui|database|auth|dashboard|examples>

Options:
  --database <d1|sqlite|turso>
  --runtime <cloudflare|node>
  --auth-methods <credentials,oauth>
  --oauth <github,google,gitlab,facebook,microsoft>
  --theme <default|neutral|zinc|stone|gray|slate|blue|green|red>
  --features <users,sessions,settings,roles>  Dashboard modules
  --yes                                      Apply without confirmation`;
}
