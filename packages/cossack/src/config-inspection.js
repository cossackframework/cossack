import path from 'node:path';
import { detectProjectRuntime } from '@cossackframework/scaffold';
import { inspectConfigRequirements } from '@cossackframework/framework/config-inspection';
import { checkConfigRequirements } from '@cossackframework/framework/config-requirements';
import { exists } from './fs-utils.js';
import { readDeploymentConfig } from './deployment.js';

/** Declaration facts only. Never evaluate factories or return environment values. */
export async function inspectConfigurationRequirements(root, { environment, check = false } = {}) {
  const inspection = await inspectConfigRequirements(root);
  const diagnostics = [...inspection.diagnostics];
  let runtime = await detectProjectRuntime(root);
  let configPath;
  for (const filename of ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml']) {
    if (await exists(path.join(root, filename))) { configPath = path.join(root, filename); break; }
  }
  runtime ??= configPath ? 'cloudflare' : 'unknown';
  const data = { factories: inspection.factories, runtime, environment: environment ?? null,
    evaluation: 'not-performed', validation: 'not-performed',
    remoteResources: 'not-checked', remoteSecrets: 'not-checked', unverifiedSecrets: [] };
  if (check) {
    if (runtime !== 'cloudflare' || !configPath) {
      diagnostics.push({ code: 'COSSACK_CONFIG_CHECK_UNAVAILABLE', severity: 'error',
        message: 'Configuration declaration checks require a Cloudflare project with readable Wrangler configuration. Process and development environment values are not inspected.' });
    } else {
      // Wrangler resolves selected-environment inheritance. These values stay private.
      const config = await readDeploymentConfig(root, configPath, environment);
      const bindingKinds = Object.create(null);
      const add = (name, kind) => { if (typeof name === 'string') bindingKinds[name] = kind; };
      for (const [field, kind] of Object.entries({ d1_databases: 'd1', kv_namespaces: 'kv', r2_buckets: 'r2', services: 'service', hyperdrive: 'object', workflows: 'object', vectorize: 'object', analytics_engine_datasets: 'object', dispatch_namespaces: 'object', send_email: 'object', mtls_certificates: 'object', pipelines: 'object', secrets_store_secrets: 'object' })) {
        for (const binding of config[field] ?? []) add(binding.binding, kind);
      }
      for (const binding of config.durable_objects?.bindings ?? []) add(binding.name, 'durable-object');
      for (const binding of config.queues?.producers ?? []) add(binding.binding, 'object');
      for (const field of ['ai', 'browser', 'assets', 'images', 'version_metadata']) add(config[field]?.binding, 'object');
      const collection = Object.fromEntries(inspection.factories.filter(factory => factory.status === 'declared').map(factory => [factory.key, factory.requirements]));
      const result = checkConfigRequirements(collection, config.vars ?? {}, {
        runtime, environment, mode: 'declarations', bindingKinds, secretNames: config.secrets?.required ?? [],
      });
      diagnostics.push(...result.diagnostics);
      data.validation = 'declarations-only';
      data.variableTypes = result.variableTypes;
      data.unverifiedSecrets = result.unverifiedSecrets;
      data.declaredSecrets = config.secrets?.required ?? [];
      data.declarationSource = path.relative(root, configPath);
    }
  }
  return { ...data, diagnostics, valid: !diagnostics.some(diagnostic => diagnostic.severity === 'error') };
}
