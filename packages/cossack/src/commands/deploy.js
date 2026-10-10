import { showCommandHelp, validateCommand } from '../command-spec.js';
import { commandSpecs } from '../command-specs.js';
import { findProjectRoot } from '../fs-utils.js';
import { commandFailure, diagnosticCode, diagnosticMessage, writeResult } from '../output.js';
import { inspectDeployment, inspectBuiltDeployment } from '../deployment.js';
import { inspectConfigurationRequirements } from '../config-inspection.js';
import { runProjectTool } from '../project-tools.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readBuildBudgets, checkBuildBudgets, prepareBudgetRun, readBudgetBatchReceipt, assertBudgetSettings, BUDGET_RUN_ENV, readAuxiliaryBuildBudgets, prepareAuxiliaryBudgetTargets, checkAuxiliaryBuildBudgets, inspectAuxiliaryBudgetArtifacts } from '../build-budgets.js';

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
    const auxiliary = await prepareAuxiliaryBudgetTargets(root, await readAuxiliaryBuildBudgets(root), environment);
    const hasBudgets = Object.keys(budgets).length > 0 || auxiliary.length > 0;
    const token = hasBudgets ? await prepareBudgetRun(root) : undefined;
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
      const exitCode = await runProjectTool(root, tool, toolArgs, name === 'build' && token
        ? { ...options, env: { ...options.env, [BUDGET_RUN_ENV]: token } } : options);
      data.steps.push({ name, exitCode, durationMs: Math.round(performance.now() - started) });
      if (name === 'build' && hasBudgets) await assertBudgetSettings(root, budgets);
      if (exitCode !== 0 && name === 'build' && token) {
        const budgetStarted = performance.now();
        let receipt;
        try {
          data.artifact = await inspectBuiltDeployment(root, inspection.config);
          receipt = await readBudgetBatchReceipt(root, data.artifact, budgets, environment, token, auxiliary);
        } catch { /* Preserve unrelated compiler/target failures as build failures. */ }
        if (receipt && (!receipt.primary.valid || !receipt.auxiliary.valid)) {
          data.buildBudgets = receipt.primary;
          data.auxiliaryBuildBudgets = receipt.auxiliary;
          data.steps.push({ name: 'budgets', exitCode: 1, durationMs: Math.round(performance.now() - budgetStarted) });
          return report(false, [...receipt.primary.diagnostics, ...receipt.auxiliary.diagnostics]);
        }
      }
      if (exitCode !== 0) return report(false, [{ code: `COSSACK_DEPLOY_${name.toUpperCase()}_FAILED`,
        severity: 'error', message: `${name} failed with exit code ${exitCode}. Run without --json for tool diagnostics.` }]);
    }
    data.artifact = await inspectBuiltDeployment(root, inspection.config);
    const budgetDiagnostics = [];
    if (hasBudgets) {
      const budgetStarted = performance.now();
      const receipt = await readBudgetBatchReceipt(root, data.artifact, budgets, environment, token, auxiliary);
      data.auxiliaryBuildBudgets = receipt?.auxiliary ?? await checkAuxiliaryBuildBudgets(root, auxiliary, environment);
      data.buildBudgets = receipt?.primary ?? (Object.keys(budgets).length ? await checkBuildBudgets(root, data.artifact, budgets, { env: options.env }) : { valid: true, measurements: [], diagnostics: [] });
      data.steps.push({ name: 'budgets', exitCode: data.buildBudgets.valid && data.auxiliaryBuildBudgets.valid ? 0 : 1, durationMs: Math.round(performance.now() - budgetStarted) });
      budgetDiagnostics.push(...data.buildBudgets.diagnostics, ...data.auxiliaryBuildBudgets.diagnostics);
      if (!data.buildBudgets.valid || !data.auxiliaryBuildBudgets.valid) return report(false, budgetDiagnostics);
      if (auxiliary.length) {
        await inspectAuxiliaryBudgetArtifacts(root, auxiliary, environment);
        data.artifact = await inspectBuiltDeployment(root, inspection.config);
      }
      if (ctx.dryRun) return report(true, budgetDiagnostics);
    }
    const started = performance.now();
    const exitCode = await runProjectTool(root, 'wrangler', ['deploy', '--config', data.artifact,
      ...(ctx.dryRun ? ['--dry-run'] : [])], { ...options, env: { ...options.env, CLOUDFLARE_ENV: '' } });
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
Auxiliary budget policies validate selected built Workers locally. This command
uploads only the primary Worker.
--json emits one versioned result with diagnostics and step results; tool
output is suppressed to prevent configuration and secret values leaking.`);
}
