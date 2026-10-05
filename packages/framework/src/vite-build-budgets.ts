/** Node-only budget gate for Cloudflare's completed Vite application build. */
import type { Plugin } from 'vite';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readBuildBudgets, checkBuildBudgets, type BuildBudgets } from './build-budgets.js';
import { findCloudflareConfig, readCloudflareDeclarationConfig, resolveConfigRuntime } from './config-preflight.js';
import { inspectBuiltDeployment } from './deployment-artifact.js';
import type { ConfigRuntime } from './config-requirements.js';

/** Place after cloudflare(). Budgets apply to the primary deployment Worker. */
export function cossackBuildBudgets(options: { runtime?: ConfigRuntime; environment?: string } = {}): Plugin {
  let root = '';
  let environment: string | undefined;
  let budgets: BuildBudgets = {};
  let expected: Record<string, any> | undefined;
  const fail = (code: string, message: string): never => { throw Object.assign(new Error(`${code}: ${message}`), { code }); };
  return {
    name: 'cossack-build-budgets',
    enforce: 'post',
    apply: 'build',
    async configResolved(config) {
      root = config.root;
      environment = options.environment ?? process.env.CLOUDFLARE_ENV;
      budgets = await readBuildBudgets(root);
      if (!Object.keys(budgets).length) return;
      if (await resolveConfigRuntime(root, options.runtime) !== 'cloudflare') {
        fail('COSSACK_BUILD_BUDGET_RUNTIME_UNSUPPORTED', 'Configured build budgets require a Cloudflare Worker artifact.');
      }
      const file = await findCloudflareConfig(root);
      if (!file) fail('COSSACK_DEPLOY_CONFIG_MISSING', 'Cloudflare configuration is required for build budgets.');
      expected = await readCloudflareDeclarationConfig(root, file!, environment);
      // A failed or custom build cannot reuse metadata from an earlier build.
      await rm(join(root, '.wrangler/deploy/config.json'), { force: true });
    },
    buildApp: {
      order: 'post',
      async handler(builder) {
        if (!Object.keys(budgets).length) return;
        const workers = Object.values(builder.environments).filter(item => item.config.consumer === 'server');
        if (!workers.length || workers.some(item => !item.isBuilt)) {
          fail('COSSACK_BUILD_BUDGET_BUILD_INCOMPLETE', 'Cloudflare Worker environments must finish before budget measurement.');
        }
        const artifact = await inspectBuiltDeployment(root, expected!);
        const result = await checkBuildBudgets(root, artifact, budgets, { env: { CLOUDFLARE_ENV: environment ?? '' } });
        for (const diagnostic of result.diagnostics) {
          if (diagnostic.severity === 'warning') builder.config.logger.warn(`${diagnostic.code}: ${diagnostic.message}`);
        }
        if (!result.valid) fail('COSSACK_BUILD_BUDGET_FAILED', result.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'));
      },
    },
  };
}
