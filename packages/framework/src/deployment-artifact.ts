/** Node-only verification shared by CLI deployment and direct Vite budgets. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readCloudflareDeclarationConfig } from './config-preflight.js';
import { isFrameworkAssetPattern } from '@cossackframework/core/static-assets';
import { describeUncoveredClientOutput, uncoveredClientOutput } from './static-asset-routing.js';
export { ASSETS_RUN_WORKER_FIRST, STATIC_ASSET_DIRECTORY, isFrameworkAssetPattern, isPolicyPreservingRunWorkerFirst, isStaticAssetFile } from '@cossackframework/core/static-assets';
export { checkStaticAssetNamespace, describeUncoveredClientOutput, uncoveredClientOutput } from './static-asset-routing.js';
export type { StaticAssetNamespaceDiagnostic, StaticAssetNamespaceOptions, StaticAssetRouteFact } from './static-asset-routing.js';
export { checkReservedPaths, checkTransportRouteNamespace } from './reserved-paths.js';
export type { ReservedPathDiagnostic, TransportRouteDiagnostic, TransportRouteNamespaceOptions } from './reserved-paths.js';
export { RESERVED_TRANSPORT_PATHS, TRANSPORT_ROUTES, findReservedTransportPath } from './transport-routes.js';
export type { ReservedTransportPath } from './transport-routes.js';
const TARGET_FIELDS = ['name', 'compatibility_date', 'compatibility_flags', 'vars', 'secrets', 'd1_databases', 'kv_namespaces', 'r2_buckets', 'hyperdrive', 'services', 'workflows',
  'durable_objects', 'queues', 'vectorize', 'analytics_engine_datasets', 'send_email', 'ai', 'browser', 'images', 'version_metadata',
  'mtls_certificates', 'dispatch_namespaces', 'pipelines', 'secrets_store_secrets', 'ratelimits', 'worker_loaders', 'vpc_services', 'vpc_networks',
  'containers', 'cloudchamber', 'unsafe', 'ai_search', 'ai_search_namespaces', 'agent_memory', 'websearch', 'artifacts', 'media', 'stream', 'unsafe_hello_world', 'flagship',
  'account_id', 'migrations', 'triggers', 'routes', 'route', 'tail_consumers'];
function deploymentTarget(config: Record<string, any>, field: string, root: string) {
  if (field === 'triggers') return { ...config.triggers, crons: config.triggers?.crons ?? [] };
  if (field !== 'd1_databases') return config[field];
  const directory = path.dirname(config.configPath ?? path.join(root, 'wrangler.jsonc'));
  return (config.d1_databases ?? []).map((binding: Record<string, any>) => ({
    ...binding,
    // Vite rewrites this source-relative tooling path in its generated config.
    // Compare resolved directories, preserving every other binding setting.
    migrations_dir: path.resolve(directory, binding.migrations_dir ?? 'migrations'),
    migrations_pattern: binding.migrations_pattern === undefined ? undefined : path.resolve(directory, binding.migrations_pattern.replace(/\\/g, '/')),
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
  return inspectDeploymentArtifact(root, artifact, expected);
}

/** Verify an independently selected artifact; auxiliary Workers omit assets. */
export async function inspectDeploymentArtifact(root: string, artifact: string, expected: Record<string, any>, includeAssets = true) {
  const built = await readCloudflareDeclarationConfig(root, artifact, '');
  for (const field of TARGET_FIELDS) {
    if (!isDeepStrictEqual(deploymentTarget(built, field, root), deploymentTarget(expected, field, root))) {
      throw new DeploymentError('COSSACK_DEPLOY_TARGET_MISMATCH',
        `Built ${field} differs from the selected Cloudflare environment. Check the Vite configuration.`);
    }
  }
  if (includeAssets) for (const field of ['binding', 'run_worker_first', 'html_handling', 'not_found_handling']) {
    if (!isDeepStrictEqual(built.assets?.[field], expected.assets?.[field])) {
      throw new DeploymentError('COSSACK_DEPLOY_TARGET_MISMATCH',
        `Built assets.${field} differs from the selected Cloudflare environment.`);
    }
  }
  // Cloudflare serves the pattern's `/assets/*` without the Worker. Hashed
  // output written elsewhere still works but invokes the Worker per request.
  if (includeAssets && isFrameworkAssetPattern(built.assets?.run_worker_first) && typeof built.assets?.directory === 'string') {
    // Wrangler keeps assets.directory relative to the configuration file.
    const directory = path.resolve(path.dirname(built.configPath ?? artifact), built.assets.directory);
    let manifest: unknown;
    try { manifest = JSON.parse(await fs.readFile(path.join(directory, '.vite/manifest.json'), 'utf8')); }
    catch { manifest = undefined; }
    const uncovered = uncoveredClientOutput(manifest);
    if (uncovered.length) throw new DeploymentError('COSSACK_ASSETS_PATTERN_UNCOVERED', describeUncoveredClientOutput(uncovered));
  }
  return artifact;
}
