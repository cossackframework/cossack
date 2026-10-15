import { readCloudflareDeclarationConfig, findCloudflareConfig } from '@cossackframework/framework/config-preflight';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DeploymentError, ASSETS_RUN_WORKER_FIRST, checkReservedPaths, isPolicyPreservingRunWorkerFirst } from '@cossackframework/framework/deployment-artifact';
export { DeploymentError, inspectBuiltDeployment } from '@cossackframework/framework/deployment-artifact';
import { exists } from './fs-utils.js';

const RESOURCE_GROUPS = {
  d1_databases: { binding: 'binding', reference: 'database_id', referenceKind: 'id',
    named: 'database_name', kind: 'D1 database' },
  kv_namespaces: { binding: 'binding', reference: 'id', referenceKind: 'id', kind: 'KV namespace' },
  r2_buckets: { binding: 'binding', reference: 'bucket_name', referenceKind: 'name', kind: 'R2 bucket' },
  hyperdrive: { binding: 'binding', reference: 'id', referenceKind: 'id', kind: 'Hyperdrive configuration' },
  services: { binding: 'binding', reference: 'service', referenceKind: 'service', kind: 'Worker service' },
  workflows: { binding: 'binding', reference: 'name', referenceKind: 'name', kind: 'Workflow' },
};
const SECRET_NAME = /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY)/i;
const PLACEHOLDER = /^(?:0{8}-0{4}-0{4}-0{4}-0{12}|0{32}|PLEASE_CHANGE.*|YOUR[_ -].*|<.*>|xxx)$/i;

function setupAction(type, referenceKind, configured, reference) {
  const target = type === 'queues' ? 'Queue' : RESOURCE_GROUPS[type].kind;
  if (configured) {
    return `Verify that this ${target.toLowerCase()} exists and is accessible in the intended Cloudflare account.`;
  }
  if (type === 'd1_databases') {
    if (referenceKind === 'name') {
      return 'Set database_id for this D1 database before deployment. Use `pnpm exec wrangler d1 list` to find an existing ID, or `pnpm exec wrangler d1 create <NAME> --update-config --binding <BINDING>` to create a remote database and write its ID into Wrangler config. Add `--env <ENV>` when targeting a named Wrangler environment.';
    }
    if (!reference) {
      return 'Choose a remote D1 database and configure both database_name and database_id before deployment.';
    }
    if (typeof reference === 'string' && PLACEHOLDER.test(reference)) {
      return 'Replace the D1 database_id placeholder with the intended remote database ID before deployment.';
    }
    return 'Set a valid, non-placeholder D1 database_id before deployment.';
  }
  if (type === 'hyperdrive') {
    return 'Create or select a Hyperdrive configuration and replace its placeholder ID before deployment.';
  }
  if (type === 'kv_namespaces') {
    return 'Create or select a KV namespace and configure its id before deployment.';
  }
  if (type === 'r2_buckets') {
    return 'Create or select an R2 bucket and configure bucket_name before deployment.';
  }
  if (type === 'services') {
    return 'Deploy or select the target Worker service and configure its service name before deployment.';
  }
  if (type === 'workflows') {
    return 'Configure the target Workflow name before deployment.';
  }
  if (type === 'queues') {
    return 'Create or select a Queue and configure queues.producers[].queue before deployment.';
  }
  return `Configure a ${referenceKind} reference for this ${target.toLowerCase()} before deployment.`;
}

function planBinding(type, name, reference, referenceKind, complete = true, nextAction) {
  const configured = typeof reference === 'string' && reference.trim().length > 0 && !PLACEHOLDER.test(reference) &&
    (type !== 'd1_databases' || referenceKind === 'id') && complete;
  return {
    type,
    name,
    resource: reference ?? null,
    referenceKind,
    configuration: configured ? 'configured' : 'unresolved',
    remote: 'not-checked',
    nextAction: nextAction ?? setupAction(type, referenceKind, configured, reference),
  };
}

async function projectWrangler(root) {
  try {
    const require = createRequire(path.join(root, 'package.json'));
    return await import(pathToFileURL(require.resolve('wrangler')).href);
  } catch {
    throw new DeploymentError('COSSACK_WRANGLER_UNAVAILABLE',
      'Install the project dependencies, including Wrangler, before deploying.');
  }
}

/** Use Wrangler's own parser, normalization, and environment inheritance rules. */
export async function readDeploymentConfig(root, configPath, environment) {
  return readCloudflareDeclarationConfig(root, configPath, environment);
}

/** Local inspection only: never reads secret values from Cloudflare or provisions resources. */
export async function inspectDeployment(root, environment) {
  const configPath = await findCloudflareConfig(root);
  if (!configPath) throw new DeploymentError('COSSACK_WRANGLER_CONFIG_MISSING',
    'No selected Wrangler configuration was found. Check the project root or CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH.');
  const config = await readDeploymentConfig(root, configPath, environment);
  const diagnostics = [];
  const bindings = [];
  const error = (code, message) => diagnostics.push({ code, severity: 'error', message });
  if (config.durable_objects?.bindings?.some(binding => binding.name === 'COSSACK_SSE') &&
      (!config.compatibility_flags?.includes('enable_request_signal') ||
       config.compatibility_flags.includes('disable_request_signal'))) {
    error('COSSACK_REQUEST_SIGNAL_REQUIRED',
      `Add enable_request_signal to compatibility_flags${environment ? ` for env.${environment}` : ''} and remove disable_request_signal so disconnected RPC callers cancel pending work.`);
  }
  if (environment) {
    // Wrangler does not inherit bindings into named environments. Compare the
    // raw top-level Durable Object bindings with the selected environment so a
    // silently dropped binding fails before the build.
    const wrangler = await projectWrangler(root);
    let rawConfig;
    try { ({ rawConfig } = wrangler.experimental_readRawConfig({ config: configPath })); }
    catch { throw new DeploymentError('COSSACK_WRANGLER_CONFIG_INVALID', 'Wrangler could not validate the configuration. Check its syntax and binding declarations.'); }
    const declared = rawConfig.env?.[environment]?.durable_objects?.bindings;
    for (const binding of rawConfig.durable_objects?.bindings ?? []) {
      if (!declared?.some(candidate => candidate.name === binding.name && candidate.class_name === binding.class_name)) {
        error('COSSACK_ENV_BINDING_NOT_INHERITED',
          `Durable Object binding ${binding.name} is declared at the top level but Cloudflare environments do not inherit bindings. Re-declare it inside env.${environment}.`);
      }
    }
  }
  if (config.assets && !isPolicyPreservingRunWorkerFirst(config.assets.run_worker_first)) {
    error('COSSACK_ASSETS_WORKER_FIRST_REQUIRED',
      `Set assets.run_worker_first to true or to ${JSON.stringify(ASSETS_RUN_WORKER_FIRST)}. Any other value lets Cloudflare serve public files before authentication and route policies run.`);
  }
  // `public/assets/` and routes under `/assets` would skip the Worker; routes at
  // transport paths never run. The build reports the same diagnostics.
  for (const diagnostic of checkReservedPaths(root)) error(diagnostic.code, diagnostic.message);
  if (config.assets && config.assets.binding !== 'ASSETS') {
    error('COSSACK_ASSETS_BINDING_REQUIRED', 'Set assets.binding to ASSETS for framework asset serving.');
  }
  for (const name of Object.keys(config.vars ?? {})) {
    if (SECRET_NAME.test(name)) error('COSSACK_SECRET_IN_VARS',
      `Move ${name} from vars to a Worker secret and declare it in secrets.required.`);
    else if (typeof config.vars[name] === 'string' && PLACEHOLDER.test(config.vars[name])) {
      error('COSSACK_VARIABLE_PLACEHOLDER', `Replace the placeholder for ${name}.`);
    }
  }
  const appUrl = config.vars?.APP_URL;
  if (appUrl !== undefined) {
    try {
      const url = new URL(appUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.hostname === 'example.com') throw new Error();
    } catch { error('COSSACK_APP_URL_INVALID', 'Set APP_URL to the application URL for this environment.'); }
  }
  for (const [type, fields] of Object.entries(RESOURCE_GROUPS)) {
    for (const binding of config[type] ?? []) {
      const id = binding[fields.reference];
      const named = fields.named ? binding[fields.named] : undefined;
      const idPresent = typeof id === 'string' && id.trim().length > 0;
      const reference = idPresent ? id : named;
      const referenceKind = idPresent ? fields.referenceKind : named ? 'name' : fields.referenceKind;
      const databaseNameConfigured = typeof named === 'string' && named.trim().length > 0 && !PLACEHOLDER.test(named);
      const databaseIdConfigured = typeof id === 'string' && id.trim().length > 0 && !PLACEHOLDER.test(id);
      const d1Complete = type !== 'd1_databases' || (databaseNameConfigured && databaseIdConfigured);
      let nextAction;
      if (type === 'd1_databases' && !databaseNameConfigured) {
        nextAction = databaseIdConfigured
          ? 'Set database_name to the name associated with this D1 database before deployment.'
          : 'Choose a remote D1 database and configure both database_name and database_id before deployment.';
      } else if (type === 'd1_databases' && !databaseIdConfigured) {
        nextAction = setupAction(type, referenceKind, false, reference);
      }
      const plan = planBinding(type, binding[fields.binding], reference, referenceKind, d1Complete, nextAction);
      bindings.push(plan);
      if (typeof reference === 'string' && PLACEHOLDER.test(reference)) {
        error('COSSACK_BINDING_PLACEHOLDER', `Replace the placeholder resource for ${binding[fields.binding]}.`);
      }
      if (type === 'd1_databases' && !databaseIdConfigured) {
        error('COSSACK_D1_DATABASE_ID_REQUIRED',
          `Set database_id for D1 binding ${binding[fields.binding]} before remote deployment. Local development can continue to use local D1.`);
      }
      if (type === 'd1_databases' && !databaseNameConfigured) {
        error('COSSACK_D1_DATABASE_NAME_REQUIRED',
          `Set a non-placeholder database_name for D1 binding ${binding[fields.binding]} before remote deployment.`);
      }
    }
  }
  for (const binding of config.durable_objects?.bindings ?? []) {
    bindings.push({ type: 'durable_objects', name: binding.name, className: binding.class_name,
      configuration: binding.class_name ? 'configured' : 'unresolved', remote: 'not-checked' });
  }
  for (const binding of config.queues?.producers ?? []) {
    bindings.push(planBinding('queues', binding.binding, binding.queue, 'name'));
  }
  if (!config.main || !await exists(config.main)) error('COSSACK_WORKER_ENTRY_MISSING',
    'The configured Worker entry file does not exist.');
  return {
    config,
    summary: { projectRoot: root, configPath, environment: environment ?? null,
      worker: config.name ?? null, bindings,
      requiredSecrets: config.secrets?.required ?? [],
      remoteSecrets: 'not-checked' },
    diagnostics,
  };
}
