/**
 * `cossack cache` — cache tooling.
 *
 * Subcommands:
 *   make-table   Generate the `cache_items` migration for the database cache
 *                driver under src/migrations/.
 *
 * The database cache driver depends on @cossackframework/database, so make-table
 * is only useful after `cossack add database`. Run the generated migration with
 * `cossack migration up`.
 */
import path from 'node:path';
import { resolveMigrationTarget } from '../names.js';
import { writeFile, exists } from '../fs-utils.js';
import { createCacheTableMigration } from '../templates.js';

export async function cacheCommand(args, ctx) {
  const [sub] = args;
  if (sub === 'make-table') return makeTable(args.slice(1), ctx);
  console.error(
    `Unknown cache subcommand: ${sub || '(none)'}.\nAvailable: make-table`,
  );
  return 1;
}

/**
 * `cossack cache:make-table` — writes
 * `src/migrations/<timestamp>_create_cache_table.ts`, the migration that creates
 * the `cache_items` table used by DatabaseCacheStore.
 *
 * Pure file/string work — no tsx needed. The migration runs under the existing
 * `cossack migration up` flow (which already respawns under tsx).
 */
async function makeTable(_rest, ctx) {
  const root = ctx.projectRoot || process.cwd();
  const migrationsDir = path.resolve(root, 'src', 'migrations');

  // Guard: the database cache driver depends on @cossackframework/database.
  // Check package.json deps before generating a migration that imports it.
  const pkgJsonPath = path.resolve(root, 'package.json');
  if (await exists(pkgJsonPath)) {
    const { readJsonIfExists } = await import('../fs-utils.js');
    const pkg = await readJsonIfExists(pkgJsonPath);
    const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
    if (!Object.keys(deps).some((d) => d === '@cossackframework/database')) {
      console.error(
        '  error   @cossackframework/database is not installed.\n' +
          '          The database cache driver needs it. Run `cossack add database` first.',
      );
      return 1;
    }
  }

  // Check for an existing cache table migration to avoid duplicates on re-run.
  const fs = await import('node:fs/promises');
  let existing;
  try {
    const files = await fs.readdir(migrationsDir);
    existing = files.find((f) => /create_cache_table\.ts$/.test(f));
  } catch {
    // migrations dir doesn't exist yet — resolveMigrationTarget will create it.
    existing = undefined;
  }

  const target = resolveMigrationTarget('create_cache_table');
  const full = path.resolve(root, target.full);
  if (existing) {
    const rel = path.relative(process.cwd(), path.resolve(migrationsDir, existing));
    console.log(`  exists   ${rel} — cache table migration already present`);
    return 0;
  }

  const content = createCacheTableMigration();
  const result = await writeFile(full, content, ctx);
  const rel = path.relative(process.cwd(), full);
  switch (result) {
    case 'wrote':
      console.log(`  created  ${rel}`);
      console.log('  next     run `cossack migration up` to apply it');
      return 0;
    case 'overwrote':
      console.log(`  overwrite ${rel}`);
      return 0;
    case 'dry-run':
      console.log(`  would create  ${rel}`);
      return 0;
    case 'skipped':
      console.log(`  skipped  ${rel} (already exists; use --force to overwrite)`);
      return 0;
    default:
      return 0;
  }
}
