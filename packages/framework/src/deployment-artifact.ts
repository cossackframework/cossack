/** Node-only verification shared by CLI deployment and direct Vite budgets. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readCloudflareDeclarationConfig } from './config-preflight.js';
const TARGET_FIELDS = ['name', 'compatibility_date', 'compatibility_flags', 'vars', 'secrets', 'd1_databases', 'kv_namespaces', 'r2_buckets', 'hyperdrive', 'services', 'workflows',
  'durable_objects', 'queues'];
function deploymentTarget(config: Record<string, any>, field: string, root: string) {
  if (field !== 'd1_databases') return config[field];
  const directory = path.dirname(config.configPath ?? path.join(root, 'wrangler.jsonc'));
  return (config.d1_databases ?? []).map((binding: Record<string, any>) => ({
    ...binding,
    // Vite rewrites this source-relative tooling path in its generated config.
    // Compare resolved directories, preserving every other binding setting.
    migrations_dir: path.resolve(directory, binding.migrations_dir ?? 'migrations'),
  }));
}

export class DeploymentError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Require the built artifact to match the selected source configuration. */
export async function inspectBuiltDeployment(root: string, expected: Record<string, any>) {
  const redirectPath = path.join(root, '.wrangler/deploy/config.json');
  let artifact;
  try {
    const redirect = JSON.parse(await fs.readFile(redirectPath, 'utf8'));
    if (typeof redirect.configPath !== 'string') throw new Error();
    artifact = path.resolve(path.dirname(redirectPath), redirect.configPath);
  } catch {
    throw new DeploymentError('COSSACK_DEPLOY_ARTIFACT_MISSING',
      'The build did not produce Cloudflare deployment metadata. Enable the Cloudflare Vite plugin.');
  }
  const built = await readCloudflareDeclarationConfig(root, artifact, '');
  for (const field of TARGET_FIELDS) {
    if (!isDeepStrictEqual(deploymentTarget(built, field, root), deploymentTarget(expected, field, root))) {
      throw new DeploymentError('COSSACK_DEPLOY_TARGET_MISMATCH',
        `Built ${field} differs from the selected Cloudflare environment. Check the Vite configuration.`);
    }
  }
  for (const field of ['binding', 'run_worker_first', 'html_handling', 'not_found_handling']) {
    if (!isDeepStrictEqual(built.assets?.[field], expected.assets?.[field])) {
      throw new DeploymentError('COSSACK_DEPLOY_TARGET_MISMATCH',
        `Built assets.${field} differs from the selected Cloudflare environment.`);
    }
  }
  return artifact;
}
