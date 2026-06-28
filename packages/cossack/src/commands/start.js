import path from 'node:path';
import { exists, findProjectRoot } from '../fs-utils.js';
import { run } from '../spawn.js';

export async function startCommand(args, ctx) {
  const root = await findProjectRoot(ctx.cwd);
  const adapter = await detectAdapter(root);

  if (adapter === 'cloudflare') {
    console.log('  start   wrangler dev');
    return run('wrangler', ['dev', ...args]);
  }

  // node adapter
  const entry = path.resolve(root, 'dist/server/index.js');
  if (!(await exists(entry))) {
    console.error('  error   dist/server/index.js not found. Run `cossack build` first.');
    return 1;
  }
  console.log('  start   node dist/server/index.js');
  return run('node', [entry, ...args]);
}

export async function detectAdapter(root) {
  // Cloudflare: wrangler.jsonc / wrangler.toml present
  const isCf =
    (await exists(path.join(root, 'wrangler.jsonc'))) ||
    (await exists(path.join(root, 'wrangler.toml')));
  if (isCf) return 'cloudflare';
  return 'node';
}

export function startHelp() {
  return `cossack start

Start the production server.
  - Cloudflare adapter: \`wrangler dev\`
  - Node adapter: \`node dist/server/index.js\`
Adapter is auto-detected from wrangler.jsonc presence.`;
}
