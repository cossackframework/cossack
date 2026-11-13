import fs from 'node:fs/promises';
import path from 'node:path';
import { findCloudflareConfig } from '@cossackframework/framework/config-preflight';
import { PLUGIN_LOADER_BINDING, pluginPlacement } from '@cossackframework/framework/plugin-isolation';
import { detectProjectRuntime } from '@cossackframework/scaffold';
import { createJsoncEditor, jsoncProperty, parseJsoncObject } from './jsonc-edit.js';

/**
 * Where a rendered plugin's server code runs in this application, as its build will decide
 * (specs/cms-plugin-isolation.md): `isolated` in a Worker of its own on Cloudflare, or `app`.
 */
export async function pluginRuntime(root, name) {
  const runtime = (await detectProjectRuntime(root)) ?? 'node';
  return { ...pluginPlacement(root, { name, version: '', manifest: `src/plugins/${name}/plugin.json` }, runtime), runtime };
}

/** One line for people: what the build will enforce for this plugin. */
export function runtimeLine(name, placement) {
  if (placement.mode === 'isolated') {
    return placement.server
      ? `${name} runs isolated: its server code gets a Worker of its own, and reaches only what it is granted.`
      : `${name} has no server code to run.`;
  }
  return `${name} runs in the application. ${placement.reason} Its permissions are checked at build, not enforced.`;
}

const has = config => Array.isArray(config?.worker_loaders) && config.worker_loaders.some(entry => entry?.binding === PLUGIN_LOADER_BINDING);

/**
 * Add the Worker Loader binding (`worker_loaders`, `LOADER`) to the Wrangler configuration and
 * each of its environments, which do not inherit bindings. Returns the file it changed, or null.
 */
export async function ensureWorkerLoader(root) {
  const file = await findCloudflareConfig(root);
  if (!file) return null;
  const relative = path.relative(root, file);
  const manual = `Add "worker_loaders": [{ "binding": "${PLUGIN_LOADER_BINDING}" }] to ${relative} by hand.`;
  if (file.endsWith('.toml')) throw Object.assign(new Error(`${relative} is TOML, which Cossack does not edit. ${manual}`), { code: 'COSSACK_CONFIG_EDIT_UNSUPPORTED' });
  const text = await fs.readFile(file, 'utf8');
  const parsed = parseJsoncObject(text, path.basename(file));
  if (!parsed) throw Object.assign(new Error(`${relative} is not valid JSON. ${manual}`), { code: 'COSSACK_CONFIG_INVALID' });
  const targets = [];
  if (!has(parsed.value)) targets.push([parsed.root, parsed.value]);
  const environments = jsoncProperty(parsed.root, 'env');
  for (const [name, value] of Object.entries(parsed.value.env ?? {})) {
    if (!has(value)) targets.push([jsoncProperty(environments, name), value]);
  }
  if (!targets.length) return null;
  const editor = createJsoncEditor(text, parsed.source);
  for (const [node, value] of targets) editor.set(node, 'worker_loaders', [...(Array.isArray(value?.worker_loaders) ? value.worker_loaders : []), { binding: PLUGIN_LOADER_BINDING }]);
  await fs.writeFile(file, editor.apply());
  return file;
}
