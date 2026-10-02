import { commandSpecs } from '../command-specs.js';
import { addFeature, FEATURES, parseList } from '@cossackframework/scaffold';
import path from 'node:path';
import { findProjectRoot, writeFile } from '../fs-utils.js';
import { flagString } from '../flags.js';
import { UI_COMPONENTS } from '../templates.js';
import { createCommandOutput, runWithSpec } from '../command-spec.js';

const spec = commandSpecs.add;

export async function addCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
    ctx.out = createCommandOutput(ctx);
  const [feature, componentName] = args;
  if (!feature || !FEATURES.includes(feature)) {
    throw Object.assign(
      new Error(`Unknown feature: ${feature}. Available features: ${FEATURES.join(', ')}`),
      { code: 'COSSACK_FEATURE_UNKNOWN' },
    );
  }
  if (componentName && feature !== 'ui') {
    throw Object.assign(
      new Error('A component name is only supported by `cossack add ui`.'),
      { code: 'COSSACK_ARGUMENT_UNEXPECTED' },
    );
  }
  const uiComponent = componentName ? UI_COMPONENTS[componentName] : undefined;
  if (componentName && !uiComponent) {
    throw Object.assign(new Error(`Unknown UI component: ${componentName}. Available components: ${Object.keys(UI_COMPONENTS).join(', ')}`),
      { code: 'COSSACK_UI_COMPONENT_UNKNOWN' });
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
      interactive: ctx.flags.json !== true && Boolean(process.stdin.isTTY) &&
        ctx.flags.yes !== true && ctx.flags.y !== true && !ctx.dryRun,
    });

    if (result.status === 'present') {
      ctx.out.line(`  present  ${feature} is already installed`);
    }
    if (result.status === 'cancelled') {
      ctx.out.line('Cancelled. No files were changed.');
      return ctx.out.data({ feature, status: result.status });
    }
    if (uiComponent) {
      const target = path.join(
        root,
        'src/components/ui',
        `${uiComponent.className}.ts`,
      );
      const status = await writeFile(target, uiComponent.template(), ctx);
      if (status === 'skipped') throw Object.assign(new Error(`File already exists: ${target}. Use --force to overwrite.`),
        { code: 'COSSACK_FILE_EXISTS' });
      ctx.out.file(status === 'dry-run' ? 'planned' : 'created', target);
    }
    if (result.status === 'present') return ctx.out.data({ feature, status: result.status });

    const automaticallyAdded = result.addedFeatures.filter(
      (item) => item !== feature,
    );
    for (const change of result.changes.writes) {
      ctx.out.file(result.status === 'dry-run' ? 'planned' : (change.overwrite ? 'overwritten' : 'created'),
        path.join(root, change.path));
    }
    for (const change of result.changes.deletes) {
      ctx.out.file(result.status === 'dry-run' ? 'planned-delete' : 'deleted', path.join(root, change.path));
    }
    ctx.out.line(
      `${result.status === 'dry-run' ? 'Would apply' : 'Applied'} ${result.changes.writes.length} write(s)` +
      (result.changes.deletes.length ? ` and ${result.changes.deletes.length} deletion(s)` : '') +
      `. Resolved features: ${result.recipe.resolvedFeatures.join(', ') || 'minimal'}.`,
    );
    if (automaticallyAdded.length) {
      ctx.out.line(`Included prerequisites: ${automaticallyAdded.join(', ')}`);
    }
    if (feature === 'dashboard') {
      ctx.out.line(`Dashboard modules: ${result.recipe.dashboardModules.join(', ') || '(none)'}`);
    }
    if (result.status !== 'dry-run') {
      ctx.out.line('\nNext: run `pnpm install`.' +
        (result.recipe.resolvedFeatures.includes('database')
          ? '\nThen apply migrations with `cossack migration up`.'
          : ''));
    }
    return ctx.out.data({
      feature,
      status: result.status,
      resolvedFeatures: result.recipe.resolvedFeatures,
      prerequisites: automaticallyAdded,
    });
  } catch (error) {
    if (error?.code === 'COSSACK_PROMPT_ABORTED') return 130;
    throw Object.assign(
      new Error(error.message),
      { code: error.code ?? 'COSSACK_FEATURE_ADD_FAILED' },
    );
  }
  });
}

export function addHelp() {
  return commandSpecs.add.help(`cossack add <ui|database|studio|auth|dashboard|markdown|examples|desktop> [component]`);
}

/* wrapper closed below */
