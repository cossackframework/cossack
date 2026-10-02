import { commandSpecs } from '../command-specs.js';
import { run } from '../spawn.js';
import { runLifecycle } from '../lifecycle-process.js';
import { runWithSpec } from '../command-spec.js';

const spec = commandSpecs.dev;

export async function devCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
    if (ctx.flags.json) return runLifecycle('dev', 'vite', ['dev', ...args], {
      cwd: ctx.cwd, metadata: { tool: 'vite' },
    });
    console.log('  start   vite dev');
    return run('vite', ['dev', ...args]);
  });
}

export function devHelp() {
  return commandSpecs.dev.help(`cossack dev

Start the development server (delegates to \`vite dev\`).
Any extra args are forwarded to vite.
--json emits started and stopped/failed events; started confirms process
creation, not HTTP readiness. SIGINT/SIGTERM requests bounded cleanup.`);
}
