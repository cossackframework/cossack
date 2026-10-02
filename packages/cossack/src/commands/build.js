import { run, runCaptured } from '../spawn.js';
import { CommandSpec, runWithSpec } from '../command-spec.js';

const spec = new CommandSpec({ name: 'build', forwardsArgs: true });

export async function buildCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
    if (!ctx.flags.json) console.log('  build   vite build');
    // SSG runs inside `vite build` via the cossackSsg plugin's closeBundle hook,
    // so there is no separate SSG step to invoke here.
    if (ctx.flags.json === true) {
      const { code, stdout, stderr } = await runCaptured('vite', ['build', ...args]);
      return { exitCode: code, data: { exitCode: code, output: `${stdout}${stderr}`.trim() } };
    }
    return run('vite', ['build', ...args]);
  });
}

export function buildHelp() {
  return `cossack build

Create a production build (\`vite build\`). Pages marked \`ssg: true\` are
pre-rendered to static HTML during the build via the \`cossackSsg\` plugin.
Extra args are forwarded to vite.

Options:
  --json   Capture the build and emit one JSON result with its exit code.`;
}
