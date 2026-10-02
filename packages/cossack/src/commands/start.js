import path from 'node:path';
import { detectProjectRuntime } from '@cossackframework/scaffold';
import { exists, findProjectRoot } from '../fs-utils.js';
import { run } from '../spawn.js';
import { CommandSpec, runWithSpec } from '../command-spec.js';

const spec = new CommandSpec({ name: 'start', forwardsArgs: true });

export async function startCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
  if (ctx.flags.json) throw Object.assign(new Error('start is a long-running command. JSON event output is not implemented yet.'),
    { code: 'COSSACK_JSON_UNSUPPORTED' });
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
  });
}

export async function detectAdapter(root) {
  return (await detectProjectRuntime(root)) ?? 'node';
}

export function startHelp() {
  return `cossack start

Start the production server.
  - Cloudflare adapter: \`wrangler dev\`
  - Node adapter: \`node dist/server/index.js\`
Adapter is read from the scaffold manifest or package metadata, with
adapter-specific files used as a legacy fallback.`;
}
