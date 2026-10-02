import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Build tooling only. Use Wrangler's environment rules and expose names only. */
export async function readBuildBindingNames(root: string, environment?: string): Promise<string[]> {
  const config = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'].map(name => join(root, name)).find(existsSync);
  if (!config) throw new Error('COSSACK_BUILD_BINDINGS_UNKNOWN: No Wrangler configuration found.');
  let wrangler;
  try {
    const require = createRequire(join(root, 'package.json'));
    wrangler = await import(pathToFileURL(require.resolve('wrangler')).href);
  } catch {
    throw new Error('COSSACK_BUILD_BINDINGS_UNKNOWN: Install the project Wrangler dependency before building.');
  }
  try {
    const { rawConfig } = wrangler.experimental_readRawConfig({ config });
    if (environment && !Object.hasOwn(rawConfig.env ?? {}, environment)) {
      throw new Error('COSSACK_BUILD_ENVIRONMENT_UNKNOWN');
    }
    const resolved = wrangler.unstable_readConfig({ config, ...(environment ? { env: environment } : {}) }, { hideWarnings: true });
    const names: unknown[] = [
      ...(resolved.durable_objects?.bindings ?? []).map((binding: { name: string }) => binding.name),
      ...['d1_databases', 'kv_namespaces', 'r2_buckets', 'hyperdrive', 'services', 'workflows'].flatMap(group =>
        (resolved[group] ?? []).map((binding: { binding: string }) => binding.binding)),
    ];
    return [...new Set(names.filter((name): name is string => typeof name === 'string'))].sort();
  } catch (error) {
    if (error instanceof Error && error.message === 'COSSACK_BUILD_ENVIRONMENT_UNKNOWN') {
      throw new Error('COSSACK_BUILD_ENVIRONMENT_UNKNOWN: Selected Cloudflare environment is not declared.');
    }
    // Parser exceptions can include source excerpts containing secrets.
    throw new Error('COSSACK_BUILD_BINDINGS_UNKNOWN: Wrangler configuration could not be validated.');
  }
}
