/**
 * Shared runner for `cossack migration` and `cossack seeder`.
 *
 * These commands are respawned under tsx by bin/cossack.js, so by the time this
 * module runs the tsx loader is active and we can import the user's `.ts`
 * `src/db/cli.ts` and `@cossackframework/database` directly.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findProjectRoot, exists } from '../fs-utils.js';

/**
 * Dynamically import `@cossackframework/database` resolved from the user's
 * project, not the CLI package itself.
 *
 * The `cossack` CLI does not declare `@cossackframework/database` as a
 * dependency (it's optional — only migration/seeder commands use it), so a
 * bare `import('@cossackframework/database')` resolves relative to this
 * module and fails. We resolve the package via the project root instead, which
 * is where the user's app has it installed (after `cossack add database`).
 */
async function loadDatabaseApi(root) {
  const pkgDir = path.resolve(root, 'node_modules', '@cossackframework', 'database');
  if (!(await exists(pkgDir))) {
    throw new Error(
      '@cossackframework/database is not installed in this project. Run `cossack add database` ' +
        '(or `pnpm install`) first.',
    );
  }
  // The package ships as TypeScript ("main": "src/index.ts"), so resolve the
  // entry file explicitly — a bare directory import looks for index.js, which
  // doesn't exist. tsx (active via the bin respawn) compiles the .ts on import.
  const entry = path.resolve(pkgDir, 'src', 'index.ts');
  if (!(await exists(entry))) {
    throw new Error(`Could not find @cossackframework/database entry at ${entry}.`);
  }
  return import(pathToFileURL(entry).href);
}

/**
 * Loads the user's `src/db/cli.ts` and returns its `getCliClient()` result.
 * Throws a friendly error if the file or export is missing.
 */
export async function loadCliClient(root) {
  const cliPath = path.resolve(root, 'src', 'db', 'cli.ts');
  if (!(await exists(cliPath))) {
    throw new Error(
      'No src/db/cli.ts found. Run `cossack add database` first, or create ' +
        'one that exports `getCliClient()` returning a Kysely client.',
    );
  }
  const mod = await import(`${pathToFileURL(cliPath).href}?t=${Date.now()}`);
  if (typeof mod.getCliClient !== 'function') {
    throw new Error('src/db/cli.ts must export `getCliClient()` returning a Kysely client.');
  }
  return mod.getCliClient();
}

/** Wraps an operation: loads the client, runs `fn(client)`, then destroys it. */
async function withClient(root, fn) {
  const client = await loadCliClient(root);
  try {
    return await fn(client);
  } finally {
    await (client.destroy?.() ?? Promise.resolve()).catch(() => {});
  }
}

/** `cossack migration up|down` */
export async function runMigrationCommand(direction, ctx) {
  const root = await findProjectRoot(ctx.cwd);
  return withClient(root, async (client) => {
    const {
      runMigrations,
      formatMigrationResult,
      defaultMigrationsFolder,
    } = await loadDatabaseApi(root);
    const result = await runMigrations(direction, { client, folder: defaultMigrationsFolder() });
    console.log(formatMigrationResult(result));
    return result.error ? 1 : 0;
  });
}

/** `cossack migration status` */
export async function runMigrationStatus(ctx) {
  const root = await findProjectRoot(ctx.cwd);
  return withClient(root, async (client) => {
    const { getMigrationStatus, defaultMigrationsFolder } = await loadDatabaseApi(root);
    const rows = await getMigrationStatus({ client, folder: defaultMigrationsFolder() });
    if (!rows.length) {
      console.log('No migrations found in src/migrations/.');
      return 0;
    }
    for (const r of rows) {
      const state = r.executedAt ? `ran ${r.executedAt.toISOString()}` : 'pending';
      console.log(`  ${r.executedAt ? '✓' : '·'} ${r.name}  —  ${state}`);
    }
    return 0;
  });
}

/** `cossack seeder run [--only <name>]` */
export async function runSeederCommand(ctx, only) {
  const root = await findProjectRoot(ctx.cwd);
  return withClient(root, async (client) => {
    const { runSeeders, defaultSeedersFolder } = await loadDatabaseApi(root);
    const ran = await runSeeders({ client, folder: defaultSeedersFolder(), only });
    if (!ran.length) {
      console.log('No seeders found in src/seeders/.');
      return 0;
    }
    console.log(`Ran ${ran.length} seeder(s):\n  ${ran.join('\n  ')}`);
    return 0;
  });
}
