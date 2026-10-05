import { showCommandHelp, validateCommand } from '../command-spec.js';
import { commandSpecs } from '../command-specs.js';
import { findProjectRoot } from '../fs-utils.js';
import { commandFailure, diagnosticCode, diagnosticMessage, writeResult } from '../output.js';
import { inspectDeployment, inspectBuiltDeployment } from '../deployment.js';
import { inspectConfigurationRequirements } from '../config-inspection.js';
import { runProjectTool } from '../project-tools.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readBuildBudgets, checkBuildBudgets } from '../build-budgets.js';

export async function deployCommand(args, ctx) {
  if (showCommandHelp(commandSpecs.deploy, args, ctx, deployHelp)) return 0;
  if (!validateCommand(commandSpecs.deploy, args, ctx)) return 1;
  let data;
  try {
    const root = await findProjectRoot(ctx.cwd);
    const budgets = await readBuildBudgets(root);
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
    const requirements = await inspectConfigurationRequirements(root, { environment, check: true });
    data.configurationRequirements = requirements;
    if (!requirements.valid) return report(false, requirements.diagnostics);
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
    const budgetDiagnostics = [];
    if (Object.keys(budgets).length) {
      const budgetStarted = performance.now();
      data.buildBudgets = await checkBuildBudgets(root, data.artifact, budgets, { env: options.env });
      data.steps.push({ name: 'budgets', exitCode: data.buildBudgets.valid ? 0 : 1, durationMs: Math.round(performance.now() - budgetStarted) });
      budgetDiagnostics.push(...data.buildBudgets.diagnostics);
      if (!data.buildBudgets.valid) return report(false, budgetDiagnostics);
      if (ctx.dryRun) return report(true, budgetDiagnostics);
    }
    const started = performance.now();
    const exitCode = await runProjectTool(root, 'wrangler', ['deploy', '--config', data.artifact,
      ...(ctx.dryRun ? ['--dry-run'] : [])], options);
    data.steps.push({ name: 'deploy', exitCode, durationMs: Math.round(performance.now() - started) });
    return report(exitCode === 0, exitCode === 0 ? budgetDiagnostics : [...budgetDiagnostics, { code: 'COSSACK_DEPLOY_UPLOAD_FAILED',
      severity: 'error', message: 'Wrangler deployment failed. Run without --json for tool diagnostics.' }]);
  } catch (error) {
    if (ctx.flags.json === true) {
      const code = diagnosticCode(error, 'COSSACK_DEPLOY_FAILED');
      writeResult('deploy', { ok: false, data, diagnostics: [{ code,
        severity: 'error', message: diagnosticMessage(error, code) }] });
      return 1;
    }
    return commandFailure(ctx, 'deploy', error.code ?? 'COSSACK_DEPLOY_FAILED', error.message);
  }
}

export function deployHelp() {
  return commandSpecs.deploy.help(`cossack deploy [--env <name>] [--mode <vite-mode>] [--dry-run] [--json]

Validate Cloudflare configuration, generate binding types, build with the
selected environment, and deploy the verified artifact using project tools.
--dry-run builds and validates locally without uploading or provisioning.
It writes generated types and build artifacts. Remote secrets are validated
by Wrangler on a real deployment, not by the local preflight.
--json emits one versioned result with diagnostics and step results; tool
output is suppressed to prevent configuration and secret values leaking.`);
}
