import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { addCommand } from '../src/commands/add.js';

let tmp;
let ctx;

/** Scaffold a minimal project so addDatabase has package.json + wrangler.jsonc + config dir. */
function scaffoldProject() {
  fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({
      name: 'demo',
      dependencies: { '@cossackframework/framework': '^0.7.0' },
    }),
  );
  fs.writeFileSync(
    path.join(tmp, 'wrangler.jsonc'),
    ['{', '  "name": "demo",', '  "compatibility_flags": ["nodejs_compat"],', '}'].join('\n'),
  );
  fs.writeFileSync(
    path.join(tmp, 'src/index.ts'),
    [
      "import { createApp } from '@cossackframework/framework/router';",
      "import { App } from './App';",
      'const app = createApp({',
      '  AppComponent: App,',
      '});',
      'export default { fetch: app.fetch };',
      '',
    ].join('\n'),
  );
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cossack-db-'));
  ctx = { projectRoot: tmp, cwd: tmp, flags: { dialect: 'd1' }, force: false, dryRun: false };
  scaffoldProject();
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('add database (d1)', () => {
  it('scaffolds models, migrations, seeders, config and wires the entry', async () => {
    const code = await addCommand(['database'], ctx);
    expect(code).toBe(0);

    // models
    expect(fs.existsSync(path.join(tmp, 'src/models/User.ts'))).toBe(true);
    // migrations (6 default)
    const migs = fs.readdirSync(path.join(tmp, 'src/migrations'));
    expect(migs).toHaveLength(6);
    expect(migs.some((f) => f.endsWith('create_users.ts'))).toBe(true);
    expect(migs.some((f) => f.endsWith('create_oauth_accounts.ts'))).toBe(true);
    expect(migs.some((f) => f.endsWith('create_cache_table.ts'))).toBe(true);
    // seeder + config + db middleware
    expect(fs.existsSync(path.join(tmp, 'src/seeders/database.seeder.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/db/config.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/middlewares/db.ts'))).toBe(true);
    // db.ts registers the database cache driver via extendCacheDriver
    const dbMiddleware = fs.readFileSync(path.join(tmp, 'src/middlewares/db.ts'), 'utf8');
    expect(dbMiddleware).toContain('extendCacheDriver');
    expect(dbMiddleware).toContain('DatabaseCacheStore');

    // dependency added
    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@cossackframework/database']).toBeTruthy();

    // wrangler d1 binding injected
    const wrangler = fs.readFileSync(path.join(tmp, 'wrangler.jsonc'), 'utf8');
    expect(wrangler).toContain('"d1_databases"');
    expect(wrangler).toContain('"binding": "DB"');

    // src/index.ts is NOT touched (no more createApp surgery)...
    const entry = fs.readFileSync(path.join(tmp, 'src/index.ts'), 'utf8');
    expect(entry).not.toContain('dbMiddleware');

    // ...instead the db middleware is registered in src/bootstrap/middlewares.ts
    const registry = fs.readFileSync(path.join(tmp, 'src/bootstrap/middlewares.ts'), 'utf8');
    expect(registry).toContain('dbMiddleware');
    expect(registry).toContain("from '../middlewares/db'");
  });

  it('is idempotent on package.json (does not duplicate the dep)', async () => {
    await addCommand(['database'], ctx);
    ctx.force = true;
    await addCommand(['database'], ctx);
    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies).filter((k) => k === '@cossackframework/database')).toHaveLength(1);
  });

  it('turso dialect scaffolds the Turso config and skips the d1 binding', async () => {
    ctx.flags.dialect = 'turso';
    const code = await addCommand(['database'], ctx);
    expect(code).toBe(0);
    const config = fs.readFileSync(path.join(tmp, 'src/db/config.ts'), 'utf8');
    expect(config).toContain('@tursodatabase/serverless/compat');
    const wrangler = fs.readFileSync(path.join(tmp, 'wrangler.jsonc'), 'utf8');
    expect(wrangler).not.toContain('d1_databases');
    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@tursodatabase/serverless']).toBeTruthy();
  });

  it('appends to an existing src/bootstrap/middlewares.ts without duplicating', async () => {
    // Pre-create the registry with another (dummy) middleware already present.
    fs.mkdirSync(path.join(tmp, 'src/bootstrap'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'src/bootstrap/middlewares.ts'),
      [
        "import type { MiddlewareHandler } from 'hono';",
        "import { loggingMiddleware } from '../middlewares/logging';",
        '',
        'const middlewares: MiddlewareHandler[] = [',
        '  loggingMiddleware,',
        '];',
        '',
        'export default middlewares;',
        '',
      ].join('\n'),
    );

    await addCommand(['database'], ctx);

    const registry = fs.readFileSync(path.join(tmp, 'src/bootstrap/middlewares.ts'), 'utf8');
    // Original entry preserved...
    expect(registry).toContain('loggingMiddleware');
    // ...and db appended, with the import added.
    expect(registry).toContain('dbMiddleware');
    expect(registry).toContain("from '../middlewares/db'");
    // Only one dbMiddleware import (no dup).
    expect((registry.match(/dbMiddleware/g) || []).length).toBeGreaterThanOrEqual(1);
    expect((registry.match(/import \{ dbMiddleware \}/g) || []).length).toBe(1);

    // Re-running is idempotent (doesn't add a second import).
    ctx.force = true;
    await addCommand(['database'], ctx);
    const after2 = fs.readFileSync(path.join(tmp, 'src/bootstrap/middlewares.ts'), 'utf8');
    expect((after2.match(/import \{ dbMiddleware \}/g) || []).length).toBe(1);
  });
});
