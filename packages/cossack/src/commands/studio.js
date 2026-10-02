import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { findProjectRoot } from '../fs-utils.js';
import { flagString } from '../flags.js';
import { CommandSpec, runWithSpec } from '../command-spec.js';

const spec = new CommandSpec({
  name: 'studio',
  flags: {
    port: { type: 'string' },
    remote: { type: 'boolean' },
    database: { type: 'string' },
    driver: { type: 'string' },
    env: { type: 'string' },
    'no-open': { type: 'boolean' },
  },
});

export async function studioCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
  try {
    const root = await findProjectRoot(ctx.cwd);
    const requireFromProject = createRequire(path.join(root, 'package.json'));
    const rawPort = flagString(ctx.flags.port);
    const port = rawPort === undefined ? undefined : Number(rawPort);
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new Error(`--port must be an integer between 1 and 65535; received "${rawPort}".`);
    }
    const projectPackage = JSON.parse(
      await fs.readFile(path.join(root, 'package.json'), 'utf8'),
    );
    const installed = projectPackage.dependencies?.['@cossackframework/studio'] ??
      projectPackage.devDependencies?.['@cossackframework/studio'];
    if (!installed) {
      throw new Error(
        '@cossackframework/studio is not installed in this project. ' +
        'Run `cossack add studio` followed by `pnpm install`.',
      );
    }
    let packageJson;
    try {
      packageJson = requireFromProject.resolve('@cossackframework/studio/package.json');
    } catch {
      throw new Error(
        '@cossackframework/studio is not installed in this project. ' +
        'Run `cossack add studio` followed by `pnpm install`.',
      );
    }
    const entry = path.join(path.dirname(packageJson), 'dist', 'index.js');
    const module = await import(entry);
    if (typeof module.runStudio !== 'function') {
      throw new Error('@cossackframework/studio does not export runStudio().');
    }
    await module.runStudio({
      projectRoot: root,
      remote: ctx.flags.remote === true,
      database: flagString(ctx.flags.database),
      provider: flagString(ctx.flags.driver),
      env: flagString(ctx.flags.env),
      port,
      open: ctx.flags['no-open'] !== true,
    });
    return 0;
  } catch (error) {
    console.error(`  error   ${error.message}`);
    return 1;
  }
  }, studioHelp);
}

export function studioHelp() {
  return `cossack studio [options]

Open a loopback-only database inspector using this project's orm.config.ts.

Options:
  --remote                       Connect to deployed Cloudflare D1 via Wrangler
  --database <d1-binding>        Select a D1 binding
  --driver <driver>              sqlite|turso|d1|postgres|mysql
  --env <wrangler-environment>   Select a Wrangler environment
  --port <number>                Server port (default: 4983)
  --no-open                      Do not open the browser automatically
  --help, -h                     Show this help`;
}
