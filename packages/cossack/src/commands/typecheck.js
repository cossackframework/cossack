import fs from 'node:fs/promises';
import path from 'node:path';
import { generateRoutes } from '@cossackframework/framework/route-codegen';
import { generateConfigTypes } from '@cossackframework/framework/config-codegen';
import { commandSpecs } from '../command-specs.js';
import { showCommandHelp, validateCommand } from '../command-spec.js';
import { buildEffectiveRouteModel } from '../scan-routes.js';
import { findProjectRoot } from '../fs-utils.js';
import { runProjectTool } from '../project-tools.js';

const WRANGLER_FILES = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'];

/**
 * The project's TypeScript check, with the types it needs written first: a clean checkout
 * has none of them, and a build is not required to make them. A project's `typecheck` script
 * is this command, so a release that adds a generated file changes the command and not the
 * project's script.
 */
export async function typecheckCommand(args, ctx) {
  if (showCommandHelp(commandSpecs.typecheck, args, ctx, typecheckHelp)) return 0;
  if (!validateCommand(commandSpecs.typecheck, args, ctx)) return 1;
  const root = await findProjectRoot(ctx.cwd);
  const exists = file => fs.access(path.join(root, file)).then(() => true, () => false);
  const say = message => { if (ctx.flags.json !== true) console.log(message); };

  // Cloudflare: the bindings of wrangler.jsonc as the CloudflareBindings interface.
  for (const file of WRANGLER_FILES) {
    if (!await exists(file)) continue;
    const code = await runProjectTool(root, 'wrangler', ['types', '--env-interface', 'CloudflareBindings'],
      { stdio: ctx.flags.json === true ? 'ignore' : 'inherit' });
    if (code !== 0) return code;
    break;
  }
  // Typed URLs (virtual:cossack-routes) and config() keys, the served packages' included.
  const effective = await buildEffectiveRouteModel(root, { environment: process.env.CLOUDFLARE_ENV });
  if (generateRoutes(root, { ...effective.discovery, write: true }).changed) say('Generated .cossack/routes.ts');
  if (generateConfigTypes(root, { write: true }).changed) say('Generated .cossack/config.d.ts');

  return runProjectTool(root, 'typescript', ['--noEmit'], { bin: 'tsc', stdio: 'inherit' });
}

export function typecheckHelp() {
  return commandSpecs.typecheck.help(`cossack typecheck

Write the generated types, then run the project's TypeScript compiler with --noEmit:

  1. Cloudflare projects: wrangler types (worker-configuration.d.ts).
  2. .cossack/routes.ts: typed URLs of the project's and the mounted packages' pages.
  3. .cossack/config.d.ts: the keys and types of config().
  4. tsc --noEmit.

The project's "typecheck" script runs this command.`);
}
