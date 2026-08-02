import path from 'node:path';
import { createApp } from '@cossackframework/scaffold';
import { renderBanner } from '../banner.js';
import { flagString } from '../flags.js';
import { readPackageVersion } from '../pkg.js';
import {
  detectInvokedPackageManager,
  normalizePackageManager,
  packageManagerCommands,
} from '../package-manager.js';
import { checkForCossackUpdate } from '../update-notice.js';

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
  const requestedPackageManager = flagString(ctx.flags['package-manager']);
  const selectedPackageManager = normalizePackageManager(requestedPackageManager);
  if (requestedPackageManager && !selectedPackageManager) {
    console.error(
      `Invalid --package-manager "${requestedPackageManager}". ` +
      'Use npm, pnpm, yarn, bun, or deno.',
    );
    return 1;
  }

  try {
    const currentVersion = readPackageVersion();
    const packageManager = selectedPackageManager ?? detectInvokedPackageManager();
    const commands = packageManagerCommands(packageManager);
    const update = checkForCossackUpdate(currentVersion);
    console.log(`${renderBanner({ version: currentVersion })}\n`);
    const yes = ctx.flags.yes === true || ctx.flags.y === true;
    const { projectDir, adapter: used, recipe, status } = await createApp(projectName, {
      cwd: ctx.cwd,
      adapter,
      preset: flagString(ctx.flags.preset),
      features: ctx.flags.features,
      database: flagString(ctx.flags.database),
      authMethods: ctx.flags['auth-methods'],
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
    console.log(`  ${commands.install}`);
    console.log(`  ${commands.dev}`);
    const latestVersion = await update;
    if (latestVersion) {
      console.log(
        `\nUpdate available: Cossack v${currentVersion} → v${latestVersion}`,
      );
      console.log(`  After installing dependencies, run: ${commands.upgrade}`);
    }
    return 0;
  } catch (error) {
    if (error?.code === 'COSSACK_PROMPT_ABORTED') return 130;
    console.error('Error creating Cossack app:', error.message);
    return 1;
  }
}

export function createHelp() {
  return `cossack create <project-name>

Scaffold a new Cossack project.

Options:
  --adapter <cloudflare|node>
  --package-manager <manager>   npm|pnpm|yarn|bun|deno
  --preset <minimal|orm|auth|full-stack>
  --features <ui,orm,studio,auth,dashboard,markdown,examples>
  --database <d1|sqlite|turso|postgres|mysql|hyperdrive-postgres|hyperdrive-mysql>
  --auth-methods <credentials,oauth>
  --oauth <github,google,gitlab,facebook,microsoft>
  --theme <default|neutral|zinc|stone|gray|slate|blue|green|red>
  --dashboard-features <users,sessions,settings,roles>
  --yes                         Accept defaults and write without confirmation.`;
}
