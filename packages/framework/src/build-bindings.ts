import { cloudflareBindingNames, findCloudflareConfig, readCloudflareDeclarationConfig } from './config-preflight.js';
/** Build tooling only. Use the shared private reader and expose names only. */
export async function readBuildBindingNames(root: string, environment?: string, configPath?: string): Promise<string[]> {
  const config = await findCloudflareConfig(root, configPath);
  if (!config) throw new Error('COSSACK_BUILD_BINDINGS_UNKNOWN: No Wrangler configuration found.');
  try { return cloudflareBindingNames(await readCloudflareDeclarationConfig(root, config, environment)); }
  catch (error) {
    if ((error as { code?: string }).code === 'COSSACK_ENVIRONMENT_UNKNOWN') throw new Error('COSSACK_BUILD_ENVIRONMENT_UNKNOWN: Selected Cloudflare environment is not declared.');
    throw new Error('COSSACK_BUILD_BINDINGS_UNKNOWN: Wrangler configuration could not be validated.');
  }
}
