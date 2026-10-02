import { commandSpecs } from '../command-specs.js';
import { run } from '../spawn.js';
import { runWithSpec } from '../command-spec.js';

const spec = commandSpecs.dev;

export async function devCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
    if (ctx.flags.json) throw Object.assign(new Error('dev is a long-running command. JSON event output is not implemented yet.'),
      { code: 'COSSACK_JSON_UNSUPPORTED' });
    console.log('  start   vite dev');
    return run('vite', ['dev', ...args]);
  });
}

export function devHelp() {
  return commandSpecs.dev.help(`cossack dev

Start the development server (delegates to \`vite dev\`).
Any extra args are forwarded to vite.`);
}
