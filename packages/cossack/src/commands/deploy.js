import { findProjectRoot } from '../fs-utils.js';
import { commandFailure, writeResult } from '../output.js';
import { inspectDeployment, inspectBuiltDeployment } from '../deployment.js';
import { runProjectTool } from '../project-tools.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function deployCommand(args, ctx) {
  const allowed = new Set(['env', 'mode', 'dry-run', 'json', 'help', 'h']);
  for (const name of Object.keys(ctx.flags)) {
    if (!allowed.has(name)) return commandFailure(ctx, 'deploy', 'COSSACK_OPTION_UNKNOWN',
      `Unknown deploy option --${name}.`);
  }
  if (args.length) return commandFailure(ctx, 'deploy', 'COSSACK_ARGUMENT_UNEXPECTED',
    'Deploy does not accept positional arguments.');
  for (const name of ['env', 'mode']) {
    if (ctx.flags[name] !== undefined && (typeof ctx.flags[name] !== 'string' || !ctx.flags[name].trim())) {
      return commandFailure(ctx, 'deploy', 'COSSACK_OPTION_VALUE_REQUIRED',
        `--${name} requires one nonempty value.`);
    }
  }
  let data;
  try {
    const root = await findProjectRoot(ctx.cwd);
    const environment = ctx.flags.env ?? process.env.CLOUDFLARE_ENV;
    const inspection = await inspectDeployment(root, environment);
    data = { ...inspection.summary, dryRun: ctx.dryRun, steps: [], artifact: null };
    const report = (ok, diagnostics = []) => {
      if (ctx.flags.json === true) writeResult('deploy', { ok, data, diagnostics });
      else {
        for (const diagnostic of diagnostics) console.error(`${diagnostic.code}: ${diagnostic.message}`);
        console.log(ok ? (ctx.dryRun ? 'Build and deployment validation passed. Nothing was uploaded.' : 'Deployment completed.')
          : 'Deployment stopped.');
      }
      return ok ? 0 : 1;
    };
    if (inspection.diagnostics.some(item => item.severity === 'error')) return report(false, inspection.diagnostics);
    // Vite flattens the selected environment into the artifact. Do not pass
    // --env to Wrangler after building; deploy that exact artifact instead.
    const options = { env: { CLOUDFLARE_ENV: environment ?? '' },
      ...(ctx.flags.json === true ? { stdio: ['ignore', 'ignore', 'ignore'] } : {}) };
    const steps = [
      ['types', 'wrangler', ['types', '--config', inspection.summary.configPath, '--env-interface', 'CloudflareBindings', ...(environment ? ['--env', environment] : [])]],
      ['build', 'vite', ['build', ...(ctx.flags.mode ? ['--mode', ctx.flags.mode] : [])]],
    ];
    for (const [name, tool, toolArgs] of steps) {
      if (name === 'build') {
        // A successful build that omits the Cloudflare plugin must not deploy
        // metadata left by an earlier build.
        await fs.rm(path.join(root, '.wrangler/deploy/config.json'), { force: true });
      }
      const started = performance.now();
      const exitCode = await runProjectTool(root, tool, toolArgs, options);
      data.steps.push({ name, exitCode, durationMs: Math.round(performance.now() - started) });
      if (exitCode !== 0) return report(false, [{ code: `COSSACK_DEPLOY_${name.toUpperCase()}_FAILED`,
        severity: 'error', message: `${name} failed with exit code ${exitCode}. Run without --json for tool diagnostics.` }]);
    }
    data.artifact = await inspectBuiltDeployment(root, inspection.config);
    const started = performance.now();
    const exitCode = await runProjectTool(root, 'wrangler', ['deploy', '--config', data.artifact,
      ...(ctx.dryRun ? ['--dry-run'] : [])], options);
    data.steps.push({ name: 'deploy', exitCode, durationMs: Math.round(performance.now() - started) });
    return report(exitCode === 0, exitCode === 0 ? [] : [{ code: 'COSSACK_DEPLOY_UPLOAD_FAILED',
      severity: 'error', message: 'Wrangler deployment failed. Run without --json for tool diagnostics.' }]);
  } catch (error) {
    if (ctx.flags.json === true) {
      writeResult('deploy', { ok: false, data, diagnostics: [{ code: error.code ?? 'COSSACK_DEPLOY_FAILED',
        severity: 'error', message: error.message }] });
      return 1;
    }
    return commandFailure(ctx, 'deploy', error.code ?? 'COSSACK_DEPLOY_FAILED', error.message);
  }
}

export function deployHelp() {
  return `cossack deploy [--env <name>] [--mode <vite-mode>] [--dry-run] [--json]

Validate Cloudflare configuration, generate binding types, build with the
selected environment, and deploy the verified artifact using project tools.
--dry-run builds and validates locally without uploading or provisioning.
It writes generated types and build artifacts. Remote secrets are validated
by Wrangler on a real deployment, not by the local preflight.
--json emits one versioned result with diagnostics and step results; tool
output is suppressed to prevent configuration and secret values leaking.`;
}
