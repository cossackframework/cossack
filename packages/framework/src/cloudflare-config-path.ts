/** Node tooling: identical source-path priority for async preflight and sync SSG. */
import { resolve } from 'node:path';
export function cloudflareConfigCandidates(root: string, explicit?: string): string[] {
  const selected = explicit ?? (process.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH || undefined);
  if (selected !== undefined) return selected ? [resolve(root, selected)] : [];
  return ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'].map(name => resolve(root, name));
}
