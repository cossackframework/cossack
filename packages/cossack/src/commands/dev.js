import { run } from '../spawn.js';
import { CommandSpec, runWithSpec } from '../command-spec.js';

const spec = new CommandSpec({ name: 'dev', forwardsArgs: true });

export async function devCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
    if (ctx.flags.json) throw Object.assign(new Error('dev is a long-running command. JSON event output is not implemented yet.'),
      { code: 'COSSACK_JSON_UNSUPPORTED' });
    console.log('  start   vite dev');
    return run('vite', ['dev', ...args]);
  });
}

export function devHelp() {
  return `cossack dev

Start the development server (delegates to \`vite dev\`).
Any extra args are forwarded to vite.`;
}
