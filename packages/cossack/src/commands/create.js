import { showCommandHelp, validateCommand } from '../command-spec.js';
import { commandSpecs } from '../command-specs.js';
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
import { commandFailure, diagnosticCode, diagnosticMessage, writeResult } from '../output.js';

export async function createCommand(args, ctx) {
  if (showCommandHelp(commandSpecs.create, args, ctx, createHelp)) return 0;
  if (!validateCommand(commandSpecs.create, args, ctx)) return 1;
  const [projectName] = args;
  const adapter = flagString(ctx.flags.adapter);
  const requestedPackageManager = flagString(ctx.flags['package-manager']);
  const selectedPackageManager = normalizePackageManager(requestedPackageManager);

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
      writeResult('create', { data: { ...result,
        nextActions: result.status === 'created' ? [commands.install, commands.dev] : [],
        nextActionCwd: result.projectDir,
      } });
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
    const code = diagnosticCode(error, 'COSSACK_CREATE_FAILED');
    return commandFailure(ctx, 'create', code,
      ctx.flags.json === true ? diagnosticMessage(error, code) : `Error creating Cossack app: ${error.message}`,
      error?.code === 'COSSACK_PROMPT_ABORTED' ? 130 : 1);
  }
}

export function createHelp() {
  return commandSpecs.create.help(`cossack create <project-name>

Scaffold a new Cossack project.`);
}
