import { commandSpecs } from '../command-specs.js';
import path from 'node:path';
import { detectProjectRuntime } from '@cossackframework/scaffold';
import { exists, findProjectRoot } from '../fs-utils.js';
import { run } from '../spawn.js';
import { runLifecycle } from '../lifecycle-process.js';
import { runWithSpec } from '../command-spec.js';

const spec = commandSpecs.start;

export async function startCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
    const root = await findProjectRoot(ctx.cwd);
    const adapter = await detectAdapter(root);

    if (adapter === 'cloudflare') {
      if (ctx.flags.json)
        return runLifecycle('start', 'wrangler', ['dev', ...args], {
          cwd: root,
          metadata: { adapter, tool: 'wrangler' },
        });
      console.log('  start   wrangler dev');
      return run('wrangler', ['dev', ...args]);
    }

    // Process-based web adapters share the built entry and bounded lifecycle.
    const entry = path.resolve(root, 'dist/server/index.js');
    if (!(await exists(entry))) {
      throw Object.assign(new Error('dist/server/index.js not found. Run pnpm run build first.'), {
        code: 'COSSACK_SERVER_ENTRY_MISSING',
      });
    }

    const tool = 'node';
    if (!ctx.flags.json) console.log(`  start   ${tool} dist/server/index.js`);
    return runLifecycle('start', process.execPath, [entry, ...args], {
      cwd: root,
      metadata: { adapter, tool },
      json: !!ctx.flags.json,
    });
  });
}

export async function detectAdapter(root) {
  return (await detectProjectRuntime(root)) ?? 'node';
}

export function startHelp() {
  return commandSpecs.start.help(`cossack start

Start the production server.
  - Cloudflare adapter: \`wrangler dev\`
  - Node adapter: \`node dist/server/index.js\`
Extra arguments follow the server entry and are application arguments.
Adapter is read from the scaffold manifest or package metadata, with
adapter-specific files used as a legacy fallback.
--json emits started and stopped/failed events; started confirms process
creation, not HTTP readiness. SIGINT/SIGTERM requests bounded cleanup.`);
}
