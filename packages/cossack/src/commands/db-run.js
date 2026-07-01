/**
 * Shared runner for `cossack migration` and `cossack seeder`.
 *
 * These commands are respawned under tsx by bin/cossack.js, so by the time this
 * module runs the tsx loader is active and we can import the user's `.ts`
 * `src/db/config.ts` and `@cossackframework/database` directly.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findProjectRoot, exists } from '../fs-utils.js';

/**
 * Loads the user's `src/db/config.ts` and returns its `getCliClient()` result.
 * Throws a friendly error if the file or export is missing.
 */
export async function loadCliClient(root) {
  const configPath = path.resolve(root, 'src', 'db', 'config.ts');
  if (!(await exists(configPath))) {
    throw new Error(
      'No src/db/config.ts found. Run `cossack add database` first, or create ' +
        'one that exports `getCliClient()` returning a Kysely client.',
    );
  }
  const mod = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`);
  if (typeof mod.getCliClient !== 'function') {
    throw new Error('src/db/config.ts must export `getCliClient()` returning a Kysely client.');
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
    } = await import('@cossackframework/database');
    const result = await runMigrations(direction, { client, folder: defaultMigrationsFolder() });
    console.log(formatMigrationResult(result));
    return result.error ? 1 : 0;
  });
}

/** `cossack migration status` */
export async function runMigrationStatus(ctx) {
  const root = await findProjectRoot(ctx.cwd);
  return withClient(root, async (client) => {
    const { getMigrationStatus, defaultMigrationsFolder } = await import(
      '@cossackframework/database'
    );
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
    const { runSeeders, defaultSeedersFolder } = await import('@cossackframework/database');
    const ran = await runSeeders({ client, folder: defaultSeedersFolder(), only });
    if (!ran.length) {
      console.log('No seeders found in src/seeders/.');
      return 0;
    }
    console.log(`Ran ${ran.length} seeder(s):\n  ${ran.join('\n  ')}`);
    return 0;
  });
}
