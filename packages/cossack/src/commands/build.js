import { commandSpecs } from '../command-specs.js';
import { run, runCaptured } from '../spawn.js';
import { runWithSpec } from '../command-spec.js';

const spec = commandSpecs.build;

export async function buildCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
    if (!ctx.flags.json) console.log('  build   vite build');
    const selectedEnvironment = ctx.flags.env ?? (process.env.CLOUDFLARE_ENV || undefined);
    const environment = ctx.flags.env === undefined ? undefined : { CLOUDFLARE_ENV: ctx.flags.env };
    // SSG runs inside `vite build` via the cossackSsg plugin's closeBundle hook,
    // so there is no separate SSG step to invoke here.
    if (ctx.flags.json === true) {
      const { code } = await runCaptured('vite', ['build', ...args], {
        ...(environment ? { env: environment } : {}), discardOutput: true,
      });
      return { exitCode: code, data: { exitCode: code,
        ...(selectedEnvironment ? { environment: selectedEnvironment } : {}),
        ...(code ? { nextActions: ['cossack build'] } : {}) },
        diagnostics: code ? [{ code: 'COSSACK_BUILD_FAILED', severity: 'error',
          message: 'Vite build failed. Run cossack build without --json for tool diagnostics.' }] : [] };
    }
    return environment
      ? run('vite', ['build', ...args], { env: environment })
      : run('vite', ['build', ...args]);
  });
}

export function buildHelp() {
  return commandSpecs.build.help(`cossack build

Create a production build (\`vite build\`). Pages marked \`ssg: true\` are
pre-rendered to static HTML during the build via the \`cossackSsg\` plugin.
--env selects a Cloudflare environment before Vite loads project config.
Vite --mode remains an independent choice. Extra args are forwarded to Vite.`);
}
