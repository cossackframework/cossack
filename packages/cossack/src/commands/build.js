import { commandSpecs } from '../command-specs.js';
import { runProjectTool, runProjectToolCaptured } from '../project-tools.js';
import { runWithSpec } from '../command-spec.js';
import { findProjectRoot } from '../fs-utils.js';
import { readBuildBudgets, checkBuildBudgets, prepareBudgetRun, readBudgetReceipt, assertBudgetSettings, BUDGET_RUN_ENV, readAuxiliaryBuildBudgets, prepareAuxiliaryBudgetTargets, checkAuxiliaryBuildBudgets, inspectAuxiliaryBudgetArtifacts } from '../build-budgets.js';
import { inspectDeployment, inspectBuiltDeployment } from '../deployment.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const spec = commandSpecs.build;

export async function buildCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
    const root = await findProjectRoot(ctx.cwd);
    const budgets = await readBuildBudgets(root);
    if (!ctx.flags.json) console.log('  build   vite build');
    const selectedEnvironment = ctx.flags.env ?? (process.env.CLOUDFLARE_ENV || undefined);
    const environment = ctx.flags.env === undefined ? undefined : { CLOUDFLARE_ENV: ctx.flags.env };
    const auxiliary = await prepareAuxiliaryBudgetTargets(root, await readAuxiliaryBuildBudgets(root), selectedEnvironment);
    const hasBudgets = Object.keys(budgets).length > 0 || auxiliary.length > 0;
    const token = hasBudgets ? await prepareBudgetRun(root) : undefined;
    if (hasBudgets) await fs.rm(path.join(root, '.wrangler/deploy/config.json'), { force: true });
    // SSG runs inside `vite build` via the cossackSsg plugin's closeBundle hook,
    // so there is no separate SSG step to invoke here.
    if (ctx.flags.json === true || hasBudgets) {
      const { code } = await runProjectToolCaptured(root, 'vite', ['build', ...args], {
        ...(environment || token ? { env: { ...environment, ...(token ? { [BUDGET_RUN_ENV]: token } : {}) } } : {}), cwd: root, discardOutput: true,
      });
      if (hasBudgets) {
        await assertBudgetSettings(root, budgets);
        let inspected, artifact, receipt;
        // A receipt can classify a failed Vite invocation only when its completed
        // artifact still matches the selected target and this invocation.
        if (code) {
          try {
            inspected = await inspectDeployment(root, selectedEnvironment);
            if (!inspected.diagnostics.some(item => item.severity === 'error')) {
              artifact = await inspectBuiltDeployment(root, inspected.config);
              receipt = await readBudgetReceipt(root, artifact, budgets, selectedEnvironment, token);
            }
          } catch { /* An unrelated build failure must keep its build diagnostic. */ }
        } else {
          inspected = await inspectDeployment(root, selectedEnvironment);
          if (inspected.diagnostics.some(item => item.severity === 'error')) return { exitCode: 1, data: null, diagnostics: inspected.diagnostics };
          artifact = await inspectBuiltDeployment(root, inspected.config);
          receipt = await readBudgetReceipt(root, artifact, budgets, selectedEnvironment, token);
        }
        if (!code || receipt?.valid === false) {
          const auxiliaryResult = await checkAuxiliaryBuildBudgets(root, auxiliary, selectedEnvironment);
          const result = receipt ?? (Object.keys(budgets).length ? await checkBuildBudgets(root, artifact, budgets, { env: { CLOUDFLARE_ENV: selectedEnvironment ?? '' } }) : { valid: true, measurements: [], diagnostics: [] });
          if (auxiliary.length) await inspectAuxiliaryBudgetArtifacts(root, auxiliary, selectedEnvironment);
          const diagnostics = [...result.diagnostics, ...auxiliaryResult.diagnostics];
          const valid = result.valid && auxiliaryResult.valid;
          if (ctx.flags.json !== true) for (const diagnostic of diagnostics) console.error(`${diagnostic.code}: ${diagnostic.message}`);
          return { exitCode: valid ? 0 : 1, data: { exitCode: valid ? 0 : 1, buildBudgets: result, auxiliaryBuildBudgets: auxiliaryResult,
            ...(selectedEnvironment ? { environment: selectedEnvironment } : {}) }, diagnostics };
        }
      }
      if (code && ctx.flags.json !== true) console.error('COSSACK_BUILD_FAILED: Vite build failed before budget measurement.');
      return { exitCode: code, data: { exitCode: code,
        ...(selectedEnvironment ? { environment: selectedEnvironment } : {}),
        ...(code ? { nextActions: ['cossack build'] } : {}) },
        diagnostics: code ? [{ code: 'COSSACK_BUILD_FAILED', severity: 'error',
          message: 'Vite build failed. Run cossack build without --json for tool diagnostics.' }] : [] };
    }
    return environment
      ? runProjectTool(root, 'vite', ['build', ...args], { env: environment, cwd: root })
      : runProjectTool(root, 'vite', ['build', ...args], { cwd: root });
  });
}

export function buildHelp() {
  return commandSpecs.build.help(`cossack build

Create a production build (\`vite build\`). Pages marked \`ssg: true\` are
pre-rendered to static HTML during the build via the \`cossackSsg\` plugin.
--env selects a Cloudflare environment before Vite loads project config.
Vite --mode remains an independent choice. Extra args are forwarded to Vite.`);
}
