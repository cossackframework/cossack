import { commandSpecs } from '../command-specs.js';
import { run, runCaptured } from '../spawn.js';
import { runWithSpec } from '../command-spec.js';

const spec = commandSpecs.build;

export async function buildCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
    if (!ctx.flags.json) console.log('  build   vite build');
    // SSG runs inside `vite build` via the cossackSsg plugin's closeBundle hook,
    // so there is no separate SSG step to invoke here.
    if (ctx.flags.json === true) {
      const { code } = await runCaptured('vite', ['build', ...args], { discardOutput: true });
      return { exitCode: code, data: { exitCode: code, ...(code ? { nextActions: ['cossack build'] } : {}) },
        diagnostics: code ? [{ code: 'COSSACK_BUILD_FAILED', severity: 'error',
          message: 'Vite build failed. Run cossack build without --json for tool diagnostics.' }] : [] };
    }
    return run('vite', ['build', ...args]);
  });
}

export function buildHelp() {
  return commandSpecs.build.help(`cossack build

Create a production build (\`vite build\`). Pages marked \`ssg: true\` are
pre-rendered to static HTML during the build via the \`cossackSsg\` plugin.
Extra args are forwarded to vite.`);
}
