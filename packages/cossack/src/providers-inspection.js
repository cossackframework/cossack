import fs from 'node:fs/promises';
import path from 'node:path';
import { detectProjectRuntime } from '@cossackframework/scaffold';
import { storageCapabilities, assertStorageRequirements, storageRequirements } from '@cossackframework/framework/storage-capabilities';
import { inspectCacheConfigFromAst, inspectStorageOverridesFromAst } from '@cossackframework/framework/page-inspection';
import { inspectDeployment } from './deployment.js';

const DRIVERS = ['memory', 'kv', 'durable-object', 'database'];
const validName = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(value);

/** Read-only declaration inspection, never execute project configuration or contact providers. */
export async function inspectProviders(root, environment) {
  const diagnostics = [];
  const add = (code, message, source, severity = 'error') => diagnostics.push({ code, severity, message, source });
  const runtime = await detectProjectRuntime(root) ?? 'unknown';
  let variables, bindings = [];
  if (runtime === 'cloudflare') {
    try {
      const deployment = await inspectDeployment(root, environment);
      variables = deployment.config.vars ?? {};
      bindings = deployment.summary.bindings;
    } catch { add('COSSACK_PROVIDER_ENV_UNKNOWN', 'Selected Cloudflare variables/binding declarations could not be read.', 'wrangler.jsonc'); }
  }
  const cacheOverrides = new Set(); const candidates = [];
  let rateLimitOverride = false, cacheDefaultOverride = false, visited = 0;
  async function walk(directory) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (++visited > 2000) { cacheOverrides.add('*'); rateLimitOverride = true; cacheDefaultOverride = true; return; }
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { await walk(file); continue; }
      if (!entry.isFile() || !/\.(?:ts|js|mts|mjs)$/.test(entry.name)) continue;
      const source = '/' + path.relative(root, file).split(path.sep).join('/');
      const stat = await fs.stat(file);
      if (stat.size > 512 * 1024) { cacheOverrides.add('*'); rateLimitOverride = true; cacheDefaultOverride = true; candidates.push(source); continue; }
      const overrides = await inspectStorageOverridesFromAst(await fs.readFile(file, 'utf8'));
      if (overrides.cache.length || overrides.rateLimit || overrides.cacheDefault) candidates.push(source);
      for (const driver of overrides.cache) cacheOverrides.add(driver);
      rateLimitOverride ||= overrides.rateLimit; cacheDefaultOverride ||= overrides.cacheDefault ?? false;
    }
  }
  await walk(path.join(root, 'src'));
  const source = '/src/config/cache.ts';
  let parsed;
  try {
    const file = path.join(root, 'src/config/cache.ts');
    const stat = await fs.stat(file);
    if (stat.size > 512 * 1024) throw Object.assign(new Error(), { code: 'TOO_LARGE' });
    const publicVariables = variables && Object.fromEntries(['CACHE_DRIVER', 'CACHE_BINDING', 'CACHE_DO_BINDING']
      .filter(key => Object.hasOwn(variables, key) && variables[key] != null).map(key => [key, String(variables[key])]));
    parsed = await inspectCacheConfigFromAst(await fs.readFile(file, 'utf8'), publicVariables);
  } catch (error) {
    if (error.code === 'ENOENT') parsed = { status: 'resolved', selection: { status: 'resolved', value: '__default' }, stores: [
      { name: '__default', status: 'resolved', location: { line: 1 }, driver: { status: 'resolved', value: 'memory' }, binding: { status: 'resolved', value: undefined }, requires: { status: 'resolved', value: undefined } },
    ] };
    else parsed = { status: 'unknown', reason: 'Cache configuration could not be inspected within source limits.', stores: [] };
  }
  const selectedName = parsed.status === 'resolved' && parsed.selection.status === 'resolved' && !cacheDefaultOverride
    ? parsed.selection.value : undefined;
  const stores = parsed.stores.map(item => {
    const location = { file: source, ...item.location };
    const name = validName(item.name) ? item.name : 'invalid';
    if (!validName(item.name)) add('COSSACK_CACHE_STORE_INVALID', 'Cache store names must use the documented format.', location);
    const driver = item.status === 'resolved' && item.driver.status === 'resolved' && DRIVERS.includes(item.driver.value) ? item.driver.value : 'custom';
    const overridden = cacheOverrides.has(driver) || cacheOverrides.has('*');
    const capabilities = storageCapabilities('cache', overridden ? 'custom' : driver);
    const store = { name, source: location, driver, status: overridden || driver === 'custom' ? 'unknown' : item.status, capabilities,
      basis: overridden ? 'Factory override candidates exist; runtime provider traits are unknown.'
        : driver === 'custom' ? 'Custom provider traits cannot be resolved without executing its factory.'
        : 'Declared built-in profile; factory execution and remote readiness are not verified.' };
    if (item.status !== 'resolved' || item.driver.status !== 'resolved') {
      add('COSSACK_CACHE_PROVIDER_UNKNOWN', 'Cache driver cannot be resolved without executing configuration.', location); return store;
    }
    if (!validName(item.driver.value)) add('COSSACK_CACHE_DRIVER_INVALID', 'Cache driver must use the documented name format.', location);
    if (driver === 'kv' || driver === 'durable-object') {
      const binding = item.binding.status === 'resolved' ? item.binding.value === undefined ? (driver === 'kv' ? 'CACHE' : 'CACHE_DO') : item.binding.value : undefined;
      store.binding = validName(binding) ? binding : null;
      store.bindingStatus = runtime === 'cloudflare' ? 'declared' : 'not-inspected';
      if (!validName(binding)) { store.bindingStatus = 'unknown'; add('COSSACK_CACHE_BINDING_UNKNOWN', 'Cache binding name is dynamic or invalid.', location); }
      else if (runtime === 'cloudflare' && !bindings.some(item => item.name === binding && item.type === (driver === 'kv' ? 'kv_namespaces' : 'durable_objects'))) {
        store.bindingStatus = 'missing';
        add('COSSACK_CACHE_BINDING_MISSING', `Cache store requires a configured ${driver} binding.`, location, name === selectedName ? 'error' : 'warning');
      }
    }
    if (item.requires.status !== 'resolved') add('COSSACK_STORAGE_REQUIREMENTS_UNKNOWN', 'Required storage guarantees are dynamic and cannot be checked statically.', location);
    else {
      try { store.requires = storageRequirements(item.requires.value); assertStorageRequirements(capabilities, store.requires); }
      catch (error) { add(error.code ?? 'COSSACK_STORAGE_REQUIREMENTS_INVALID', error.code ? error.message : 'Storage requirements are invalid.', location); }
    }
    return store;
  });
  let selection = { status: 'unknown', reason: 'Cache default selection is dynamic or overridden.' };
  if (parsed.status === 'resolved' && parsed.selection.status === 'resolved' && !cacheDefaultOverride) {
    const selected = stores.find(store => store.name === parsed.selection.value);
    if (selected) selection = { status: 'declared', name: selected.name };
    else add('COSSACK_CACHE_DEFAULT_INVALID', 'Cache default does not select a declared store.', source);
  } else add('COSSACK_CACHE_DEFAULT_UNKNOWN', 'Cache default cannot be resolved within this declaration scope.', source);
  if (parsed.status !== 'resolved') add('COSSACK_CACHE_CONFIG_UNKNOWN', parsed.reason, source);

  const mode = variables?.rateLimit === undefined ? variables?.RATE_LIMIT : variables.rateLimit;
  const aliases = { do: 'durable-object', 'durable-object': 'durable-object', redis: 'redis', upstash: 'redis', kv: 'kv' };
  const driver = variables === undefined || rateLimitOverride ? 'custom' : mode === undefined ? 'memory'
    : typeof mode === 'string' && Object.hasOwn(aliases, mode.trim().toLowerCase()) ? aliases[mode.trim().toLowerCase()] : undefined;
  const rateLimit = { status: driver === 'custom' ? 'unknown' : driver ? 'declared' : 'invalid',
    capabilities: storageCapabilities('rate-limit', driver ?? 'custom'),
    source: runtime === 'cloudflare' ? 'selected Wrangler vars' : 'request environment (not statically resolved)' };
  if (!driver) add('COSSACK_RATE_LIMIT_PROVIDER_INVALID', 'Explicit limiter mode is invalid; it does not fall back to memory.', 'wrangler.jsonc');
  else if (driver === 'durable-object' || driver === 'kv') {
    rateLimit.binding = driver === 'kv' ? 'RATE_LIMITS' : 'RATE_LIMIT_DO';
    if (!bindings.some(item => item.name === rateLimit.binding && item.type === (driver === 'kv' ? 'kv_namespaces' : 'durable_objects'))) add('COSSACK_RATE_LIMIT_BINDING_MISSING', 'Configured limiter binding is missing or has the wrong kind.', 'wrangler.jsonc');
  } else if (driver === 'redis') rateLimit.credentials = 'runtime-secret validation required; values omitted';
  return { scope: 'providers', runtime, environment: environment ?? null,
    inspectionScope: 'Compiler declarations and selected Wrangler vars/bindings only. Process/dev/secret overrides, factory execution, provider readiness and remote guarantees are not verified.',
    cache: { default: selection, stores }, rateLimit, overrideCandidates: candidates.sort(),
    catalog: { cache: DRIVERS.map(driver => storageCapabilities('cache', driver)),
      rateLimit: ['memory', 'kv', 'durable-object', 'redis'].map(driver => storageCapabilities('rate-limit', driver)) }, diagnostics };
}
