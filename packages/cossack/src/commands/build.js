import { commandSpecs } from '../command-specs.js';
import { run, runCaptured } from '../spawn.js';
import { runWithSpec } from '../command-spec.js';
import { findProjectRoot } from '../fs-utils.js';
import { readBuildBudgets, checkBuildBudgets } from '../build-budgets.js';
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
    if (Object.keys(budgets).length) await fs.rm(path.join(root, '.wrangler/deploy/config.json'), { force: true });
    // SSG runs inside `vite build` via the cossackSsg plugin's closeBundle hook,
    // so there is no separate SSG step to invoke here.
    if (ctx.flags.json === true || Object.keys(budgets).length) {
      const { code } = await runCaptured('vite', ['build', ...args], {
        ...(environment ? { env: environment } : {}), cwd: root, discardOutput: true,
      });
      if (code && ctx.flags.json !== true) console.error('COSSACK_BUILD_FAILED: Vite build failed before budget measurement.');
      if (!code && Object.keys(budgets).length) {
        const inspected = await inspectDeployment(root, selectedEnvironment);
        if (inspected.diagnostics.some(item => item.severity === 'error')) return { exitCode: 1, data: null, diagnostics: inspected.diagnostics };
        const artifact = await inspectBuiltDeployment(root, inspected.config);
        const result = await checkBuildBudgets(root, artifact, budgets, { env: { CLOUDFLARE_ENV: selectedEnvironment ?? '' } });
        if (ctx.flags.json !== true) for (const diagnostic of result.diagnostics) console.error(`${diagnostic.code}: ${diagnostic.message}`);
        return { exitCode: result.valid ? 0 : 1, data: { exitCode: result.valid ? 0 : 1, buildBudgets: result,
          ...(selectedEnvironment ? { environment: selectedEnvironment } : {}) }, diagnostics: result.diagnostics };
      }
      return { exitCode: code, data: { exitCode: code,
        ...(selectedEnvironment ? { environment: selectedEnvironment } : {}),
        ...(code ? { nextActions: ['cossack build'] } : {}) },
        diagnostics: code ? [{ code: 'COSSACK_BUILD_FAILED', severity: 'error',
          message: 'Vite build failed. Run cossack build without --json for tool diagnostics.' }] : [] };
    }
    return environment
      ? run('vite', ['build', ...args], { env: environment, cwd: root })
      : run('vite', ['build', ...args], { cwd: root });
  });
}

export function buildHelp() {
  return commandSpecs.build.help(`cossack build

Create a production build (\`vite build\`). Pages marked \`ssg: true\` are
pre-rendered to static HTML during the build via the \`cossackSsg\` plugin.
--env selects a Cloudflare environment before Vite loads project config.
Vite --mode remains an independent choice. Extra args are forwarded to Vite.`);
}
