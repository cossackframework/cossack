/** Node-only configuration tooling. Public inspection results never contain values. */
import { readFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cloudflareConfigCandidates } from './cloudflare-config-path.js';
import { inspectConfigRequirements } from './config-inspection.js';
import { checkConfigRequirements, type BindingKind, type ConfigRuntime, type ConfigRequirementDiagnostic } from './config-requirements.js';

const RUNTIMES = ['cloudflare', 'node', 'deno', 'desktop'] as const;
export class ConfigPreflightError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ConfigPreflightError'; }
}
async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
async function json(file: string): Promise<any> { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return undefined; } }
export async function findCloudflareConfig(root: string, explicit?: string): Promise<string | undefined> {
  for (const file of cloudflareConfigCandidates(root, explicit)) if (await exists(file)) return file;
}
/** Match project metadata priority without importing the Node-only scaffold package. */
export async function resolveConfigRuntime(root: string, explicit?: ConfigRuntime): Promise<ConfigRuntime> {
  if (explicit) return explicit;
  const manifest = await json(join(root, '.cossack/scaffold.json'));
  const recorded = manifest?.runtime ?? manifest?.adapter;
  if (RUNTIMES.includes(recorded)) return recorded;
  const pkg = await json(join(root, 'package.json'));
  if (RUNTIMES.includes(pkg?.cossack?.runtime)) return pkg.cossack.runtime;
  const dependencies = { ...pkg?.dependencies, ...pkg?.devDependencies };
  if (dependencies['@cossackframework/deno-adapter']) return 'deno';
  if (dependencies['@cossackframework/node-adapter']) return 'node';
  if (dependencies['@cloudflare/vite-plugin'] || dependencies.wrangler || await findCloudflareConfig(root)) return 'cloudflare';
  return 'unknown';
}
/**
 * PRIVATE VALUE BOUNDARY: normalized Wrangler config is returned only to Node
 * deployment/check internals. Never serialize it or expose it in diagnostics.
 */
export async function readCloudflareDeclarationConfig(root: string, configPath: string, environment?: string): Promise<Record<string, any>> {
  let wrangler: typeof import('wrangler');
  try {
    const require = createRequire(join(root, 'package.json'));
    wrangler = await import(pathToFileURL(require.resolve('wrangler')).href);
  } catch { throw new ConfigPreflightError('COSSACK_WRANGLER_UNAVAILABLE', 'Install the project dependencies, including Wrangler, before checking Cloudflare configuration.'); }
  if (!wrangler.experimental_readRawConfig || !wrangler.unstable_readConfig) {
    throw new ConfigPreflightError('COSSACK_WRANGLER_API_UNSUPPORTED', 'The installed Wrangler version lacks the configuration APIs required by Cossack.');
  }
  try {
    const { rawConfig } = wrangler.experimental_readRawConfig({ config: configPath });
    if (environment && !Object.hasOwn(rawConfig.env ?? {}, environment)) {
      throw new ConfigPreflightError('COSSACK_ENVIRONMENT_UNKNOWN', `Cloudflare environment "${environment}" is not defined in the Wrangler configuration.`);
    }
    return wrangler.unstable_readConfig({ config: configPath, ...(environment !== undefined ? { env: environment } : {}) }, { hideWarnings: true });
  } catch (error) {
    if (error instanceof ConfigPreflightError) throw error;
    throw new ConfigPreflightError('COSSACK_WRANGLER_CONFIG_INVALID', 'Wrangler could not validate the configuration. Check its syntax and binding declarations.');
  }
}
function bindingKinds(config: Record<string, any>): Record<string, BindingKind> {
  const kinds: Record<string, BindingKind> = Object.create(null);
  const add = (name: unknown, kind: BindingKind) => { if (typeof name === 'string') kinds[name] = kind; };
  const groups: Record<string, BindingKind> = { d1_databases: 'd1', kv_namespaces: 'kv', r2_buckets: 'r2', services: 'service', hyperdrive: 'object', workflows: 'object', vectorize: 'object', analytics_engine_datasets: 'object', dispatch_namespaces: 'object', send_email: 'object', mtls_certificates: 'object', pipelines: 'object', secrets_store_secrets: 'object' };
  for (const [field, kind] of Object.entries(groups)) for (const binding of config[field] ?? []) add(binding.binding, kind);
  for (const binding of config.send_email ?? []) add(binding.name, 'object');
  for (const binding of config.durable_objects?.bindings ?? []) add(binding.name, 'durable-object');
  for (const binding of config.queues?.producers ?? []) add(binding.binding, 'object');
  for (const field of ['ai', 'browser', 'assets', 'images', 'version_metadata']) add(config[field]?.binding, 'object');
  return kinds;
}
/** Names only, for existing build capability checks. */
export function cloudflareBindingNames(config: Record<string, any>): string[] { return Object.keys(bindingKinds(config)).sort(); }
export interface ConfigInspectionOptions { runtime?: ConfigRuntime; environment?: string; configPath?: string; check?: boolean; }
/** Static catalog/declaration check. Does not import application modules or inspect runtime variable values. */
export async function inspectConfigurationRequirements(root: string, { runtime: explicit, environment, configPath: selectedPath, check = false }: ConfigInspectionOptions = {}) {
  const inspection = await inspectConfigRequirements(root);
  const diagnostics: (Pick<ConfigRequirementDiagnostic, 'code' | 'severity' | 'message'> & Partial<ConfigRequirementDiagnostic>)[] = [...inspection.diagnostics];
  const runtime = await resolveConfigRuntime(root, explicit);
  const configPath = await findCloudflareConfig(root, selectedPath);
  const data = { factories: inspection.factories, runtime, environment: environment ?? null,
    evaluation: 'not-performed', validation: 'not-performed', remoteResources: 'not-checked', remoteSecrets: 'not-checked',
    unverifiedSecrets: [] as string[], variableTypes: undefined as Record<string, import('./config-requirements.js').VariableType> | undefined,
    declaredSecrets: undefined as string[] | undefined, declarationSource: undefined as string | undefined };
  if (check) {
    if (runtime !== 'cloudflare' || !configPath) {
      diagnostics.push({ code: 'COSSACK_CONFIG_CHECK_UNAVAILABLE', severity: 'error', message: 'Configuration declaration checks require a Cloudflare project with readable Wrangler configuration. Process and development environment values are not inspected.' });
    } else {
      const config = await readCloudflareDeclarationConfig(root, configPath, environment);
      const collection = Object.fromEntries(inspection.factories.filter(factory => factory.status === 'declared').map(factory => [factory.key, factory.requirements!]));
      const result = checkConfigRequirements(collection, config.vars ?? {}, { runtime, environment, mode: 'declarations', bindingKinds: bindingKinds(config), secretNames: config.secrets?.required ?? [] });
      diagnostics.push(...result.diagnostics);
      data.validation = 'declarations-only'; data.variableTypes = result.variableTypes; data.unverifiedSecrets = result.unverifiedSecrets;
      data.declaredSecrets = config.secrets?.required ?? []; data.declarationSource = relative(root, configPath);
    }
  }
  return { ...data, diagnostics, valid: !diagnostics.some(diagnostic => diagnostic.severity === 'error') };
}
/** Build-time metadata checks outside Workers leave supplied runtime values unknown. */
export async function checkConfigBuildRequirements(root: string, options: Omit<ConfigInspectionOptions, 'check'> = {}) {
  const runtime = await resolveConfigRuntime(root, options.runtime);
  const result = await inspectConfigurationRequirements(root, { ...options, runtime, check: runtime === 'cloudflare' });
  if (runtime !== 'cloudflare') {
    const collection = Object.fromEntries(result.factories.filter(factory => factory.status === 'declared').map(factory => [factory.key, factory.requirements!]));
    const checked = checkConfigRequirements(collection, {}, { runtime, environment: options.environment });
    result.diagnostics.push(...checked.diagnostics.filter(diagnostic => ['COSSACK_CONFIG_REQUIREMENTS_INVALID', 'COSSACK_CONFIG_REQUIREMENT_CONFLICT', 'COSSACK_CONFIG_RUNTIME_UNSUPPORTED'].includes(diagnostic.code)));
    result.variableTypes = checked.variableTypes; result.validation = 'metadata-only';
    result.valid = !result.diagnostics.some(diagnostic => diagnostic.severity === 'error');
  }
  return { ...result, runtimeValues: runtime === 'cloudflare' ? 'declarations-only' : 'not-checked' };
}
