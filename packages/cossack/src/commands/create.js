import path from 'node:path';
import { createApp } from '@cossackframework/scaffold';
import { flagString } from '../flags.js';

export async function createCommand(args, ctx) {
  const [projectName] = args;
  if (!projectName) {
    console.error('Missing project name. Usage: cossack create <project-name>');
    return 1;
  }

  const adapter = flagString(ctx.flags.adapter);
  if (adapter && adapter !== 'cloudflare' && adapter !== 'node') {
    console.error(`Invalid --adapter "${adapter}". Use cloudflare or node.`);
    return 1;
  }

  try {
    const yes = ctx.flags.yes === true || ctx.flags.y === true;
    const { projectDir, adapter: used, recipe, status } = await createApp(projectName, {
      cwd: ctx.cwd,
      adapter,
      preset: flagString(ctx.flags.preset),
      features: ctx.flags.features,
      database: flagString(ctx.flags.database),
      oauth: ctx.flags.oauth,
      theme: flagString(ctx.flags.theme),
      dashboardModules: ctx.flags['dashboard-features'],
      yes,
      interactive: !yes,
      force: ctx.force,
    });
    if (status === 'cancelled') {
      console.log('Cancelled. No files were changed.');
      return 0;
    }
    const dirName = path.basename(projectDir);
    console.log(`\nCossack app created in ${projectDir} (adapter: ${used}, preset: ${recipe.preset})\n`);
    console.log('Next steps:');
    console.log(`  cd ${dirName}`);
    console.log('  pnpm install');
    if (used === 'node') {
      console.log('  pnpm run build');
      console.log('  pnpm start');
    } else {
      console.log('  cossack dev');
    }
    return 0;
  } catch (error) {
    console.error('Error creating Cossack app:', error.message);
    return 1;
  }
}

export function createHelp() {
  return `cossack create <project-name>

Scaffold a new Cossack project.

Options:
  --adapter <cloudflare|node>
  --preset <minimal|database|auth|full-stack>
  --features <ui,database,auth,dashboard,examples>
  --database <d1|sqlite|turso>
  --oauth <github,google,gitlab,facebook,microsoft>
  --theme <default|neutral|zinc|stone|gray|slate|blue|green|red>
  --dashboard-features <users,sessions,settings,roles>
  --yes                         Accept defaults and write without confirmation.`;
}
