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
import { commandFailure, writeResult } from '../output.js';

export async function createCommand(args, ctx) {
  const [projectName] = args;
  if (!projectName) {
    return commandFailure(ctx, 'create', 'COSSACK_PROJECT_NAME_REQUIRED',
      'Missing project name. Usage: cossack create <project-name>');
  }

  const adapter = flagString(ctx.flags.adapter);
  if (adapter && adapter !== 'cloudflare' && adapter !== 'node' && adapter !== 'deno') {
    return commandFailure(ctx, 'create', 'COSSACK_ADAPTER_INVALID',
      `Invalid --adapter "${adapter}". Use cloudflare, node, or deno.`);
  }
  const requestedPackageManager = flagString(ctx.flags['package-manager']);
  const selectedPackageManager = normalizePackageManager(requestedPackageManager);
  if (requestedPackageManager && !selectedPackageManager) {
    return commandFailure(ctx, 'create', 'COSSACK_PACKAGE_MANAGER_INVALID',
      `Invalid --package-manager "${requestedPackageManager}". ` +
      'Use npm, pnpm, yarn, bun, or deno.',
    );
  }

  try {
    const currentVersion = readPackageVersion();
    const packageManager = selectedPackageManager ?? detectInvokedPackageManager();
    const commands = packageManagerCommands(packageManager);
    const json = ctx.flags.json === true;
    const update = ctx.dryRun || json ? Promise.resolve(null) : checkForCossackUpdate(currentVersion);
    if (!json) console.log(`${renderBanner({ version: currentVersion })}\n`);
    const yes = ctx.flags.yes === true || ctx.flags.y === true;
    const result = await createApp(projectName, {
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
      interactive: !yes && !ctx.dryRun && !json && Boolean(process.stdin.isTTY),
      dryRun: ctx.dryRun,
      force: ctx.force,
    });
    if (json) {
      writeResult('create', { data: result });
      return 0;
    }
    const { projectDir, adapter: used, recipe, status, changes } = result;
    if (status === 'dry-run') {
      console.log(`Dry run: ${projectDir} (${used}, ${recipe.preset})`);
      for (const write of changes.writes) console.log(`  write ${write.path}`);
      console.log('No files were changed.');
      return 0;
    }
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
    return commandFailure(ctx, 'create', error?.code === 'COSSACK_PROMPT_ABORTED'
      ? error.code : 'COSSACK_CREATE_FAILED',
      `Error creating Cossack app: ${error.message}`,
      error?.code === 'COSSACK_PROMPT_ABORTED' ? 130 : 1);
  }
}

export function createHelp() {
  return `cossack create <project-name>

Scaffold a new Cossack project.

Options:
  --adapter <cloudflare|node|deno>
  --package-manager <manager>   npm|pnpm|yarn|bun|deno
  --preset <minimal|database|auth|full-stack>
  --features <ui,database,studio,auth,dashboard,markdown,examples,desktop>
  --database <d1|sqlite|turso|postgres|mysql|hyperdrive-postgres|hyperdrive-mysql>
  --auth-methods <credentials,oauth>
  --oauth <github,google,gitlab,facebook,microsoft>
  --theme <default|neutral|zinc|stone|gray|slate|blue|green|red>
  --dashboard-features <users,sessions,settings,roles>
  --dry-run                     Show planned files without writing or prompting.
  --json                        Emit a versioned result and run without prompts.
  --yes                         Accept defaults and write without confirmation.`;
}
