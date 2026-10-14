import { commandSpecs } from '../command-specs.js';
import { runLifecycle } from '../lifecycle-process.js';
import { findProjectRoot } from '../fs-utils.js';
import { resolveProjectTool } from '../project-tools.js';
import { runWithSpec } from '../command-spec.js';

const spec = commandSpecs.dev;

export async function devCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
    const root = await findProjectRoot(ctx.cwd);
    const vite = await resolveProjectTool(root, 'vite');
    if (!ctx.flags.json) console.log('  start   vite dev');
    const selectedEnvironment = ctx.flags.env ?? (process.env.CLOUDFLARE_ENV || undefined);
    return runLifecycle('dev', vite.command, [...vite.args, 'dev', ...args], {
      cwd: root,
      ...(ctx.flags.env === undefined ? {} : { env: { CLOUDFLARE_ENV: ctx.flags.env } }),
      metadata: { tool: 'vite', ...(selectedEnvironment ? { environment: selectedEnvironment } : {}) },
      json: !!ctx.flags.json,
    });
  });
}

export function devHelp() {
  return commandSpecs.dev.help(`cossack dev

Start the development server (delegates to \`vite dev\`).
--env selects a Cloudflare environment before Vite loads project config.
Any other extra args are forwarded to Vite.
--json emits started and stopped/failed events; started confirms process
creation, not HTTP readiness. SIGINT/SIGTERM requests bounded cleanup.`);
}
