import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
async function command(root, file, args, environment) {
  try {
    const result = await execute(process.execPath, [file, ...args], {
      cwd: root, env: environment, timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    if (error.stdout) process.stderr.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
  }
}

/** Fresh installed full-stack acceptance. Every native D1 schema statement
 * comes from the generated public migration plan, never a fixture DDL list. */
export async function verifyGeneratedMigrationPlans(installedProject, { cloudflareTools = installedProject } = {}) {
  const gate = await fs.realpath(installedProject);
  const modules = path.join(gate, 'node_modules');
  const cli = await fs.realpath(path.join(modules, 'cossack/bin/cossack.js'));
  assert.ok(cli.startsWith(gate + path.sep), 'CLI must come from the installed acceptance project');
  const toolingRequire = createRequire(path.join(cloudflareTools, 'package.json'));
  const wranglerRoot = path.dirname(toolingRequire.resolve('wrangler/package.json'));
  const environment = { ...process.env, NODE_ENV: 'production', VITEST: '', CI: 'true',
    WRANGLER_SEND_METRICS: 'false', WRANGLER_DISABLE_UPDATE_CHECK: 'true',
    WRANGLER_SEND_ERROR_REPORTS: 'false', COSSACK_DISABLE_UPDATE_CHECK: '1',
    CLOUDFLARE_CF_FETCH_ENABLED: 'false', CLOUDFLARE_API_KEY: '', CLOUDFLARE_EMAIL: '',
    CLOUDFLARE_ACCOUNT_ID: '', CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ENV: '',
    CLOUDFLARE_API_BASE_URL: 'http://127.0.0.1:1', };
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-generated-migrations-'));
  const root = path.join(temporary, 'application');
  let harness;
  try {
    await command(temporary, cli, ['create', 'application', '--adapter=cloudflare', '--preset=full-stack', '--oauth=github', '--package-manager=pnpm', '--yes'], environment);
    await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
    // Borrow installed packages only. Missing platform tools may come from a
    // second installed gate; framework packages always come from the first.
    for (const entry of await fs.readdir(modules)) {
      if (entry.startsWith('.')) continue;
      if (entry.startsWith('@')) {
        await fs.mkdir(path.join(root, 'node_modules', entry), { recursive: true });
        for (const name of await fs.readdir(path.join(modules, entry))) {
          await fs.symlink(path.join(modules, entry, name), path.join(root, 'node_modules', entry, name), 'junction');
        }
      } else await fs.symlink(path.join(modules, entry), path.join(root, 'node_modules', entry), 'junction');
    }
    for (const name of ['wrangler', '@cloudflare/vite-plugin']) {
      const target = path.join(root, 'node_modules', name);
      if (await fs.stat(target).catch(() => null)) continue;
      const source = name === 'wrangler' ? wranglerRoot : path.dirname(toolingRequire.resolve(name + '/package.json'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.symlink(source, target, 'junction');
    }
    // Full-stack declares reflect-metadata directly; a minimal documentation
    // gate can have it installed only beneath Database's dependency graph.
    const reflection = path.join(root, 'node_modules/reflect-metadata');
    if (!await fs.stat(reflection).catch(() => null)) {
      const databaseRoot = await fs.realpath(path.join(modules, '@cossackframework/database'));
      const databaseRequire = createRequire(path.join(databaseRoot, 'package.json'));
      await fs.symlink(path.dirname(databaseRequire.resolve('reflect-metadata')), reflection, 'junction');
    }
    const projectRequire = createRequire(path.join(root, 'package.json'));
    const tool = (name, relative) => path.join(path.dirname(projectRequire.resolve(name + '/package.json')), relative);
    const json = async args => {
      let result;
      try { result = JSON.parse(await command(root, cli, [...args, '--json'], environment)); }
      catch (error) {
        if (args[0] === 'migration' && ['plan', 'status'].includes(args[1])) {
          await command(root, cli, args, environment);
        }
        throw error;
      }
      assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
      return result.data;
    };
    const plan = await json(['migration', 'plan', '--local']);
    assert.equal(plan.complete, true);
    assert.equal(plan.migrations.length, 7);
    assert.ok(plan.migrations.every(migration => migration.complete && migration.direction === 'up' && migration.statements.length > 0));
    const statements = plan.migrations.flatMap(migration => migration.statements);
    assert.equal(statements.length, 9);
    assert.ok(statements.every(statement => statement.parameterCount === 0));
    assert.ok(statements.some(statement => /ADD COLUMN public_id VARCHAR\(36\)/.test(statement.text)));
    const pending = await json(['migration', 'status', '--local']);
    assert.equal(pending.migrations.length, 7);
    assert.ok(pending.migrations.every(migration => migration.state === 'pending'));
    const catalog = JSON.parse(await command(root, path.join(wranglerRoot, 'bin/wrangler.js'),
      ['d1', 'execute', 'DB', '--local', '--command', "SELECT name FROM sqlite_master WHERE type='table'", '--json'], environment));
    const authoredTables = new Set([...statements, ...plan.migrations.flatMap(migration => migration.bookkeeping)]
      .flatMap(statement => [...statement.text.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? [\"`]?([a-zA-Z_][\w]*)/gi)].map(match => match[1])));
    assert.ok(authoredTables.has('users') && authoredTables.has('_cossack_migrations'));
    assert.ok(catalog.every(result => (result.results ?? []).every(row => !authoredTables.has(row.name))),
      'Planning must not create application or bookkeeping tables (D1 platform tables are independent)');
    console.log('Installed read-only migration plan passed: seven complete migrations, nine DDL statements, no authored schema/history tables.');

    // The generated full-stack static render uses its ORM middleware. Apply
    // generated authoritative operations to its isolated local build database.
    // Native runtime below uses a different, explicitly empty D1 database.
    await json(['migration', 'up', '--local']);
    await fs.mkdir(path.join(root, 'src/pages/api'), { recursive: true });
    await fs.writeFile(path.join(root, 'src/pages/api/migration-acceptance.ts'), `import type { Context } from 'hono';
import { User } from '../../models/User';
import { Session } from '../../models/Session';
export const POST = async (c: Context) => {
  const id = crypto.randomUUID(); const publicId = crypto.randomUUID(); const now = new Date();
  await User.insert({ id, email: id + '@example.test', name: 'Acceptance', passwordHash: null, avatar: null, meta: null, createdAt: now });
  await Session.insert({ id: crypto.randomUUID(), publicId, userId: id, data: { checked: true }, meta: { type: 'auth' }, location: null, userAgent: null, ipAddress: null, createdAt: now, expiresAt: new Date(now.getTime() + 60000) });
  const user = await User.findOne({ where: { id } });
  const session = await Session.findOne({ where: { publicId } });
  return c.json({ userFound: user?.id === id, sessionFound: session?.publicId === publicId && session.userId === id, users: await User.count(), sessions: await Session.count() });
};
`);
    await json(['config', '--generate']);
    await command(root, path.join(wranglerRoot, 'bin/wrangler.js'), ['types'], environment);
    await command(root, tool('typescript', 'bin/tsc'), ['--noEmit'], environment);
    await command(root, tool('vite', 'bin/vite.js'), ['build'], environment);
    const builtConfig = JSON.parse(await fs.readFile(path.join(root, 'dist/ssr/wrangler.json'), 'utf8'));
    builtConfig.d1_databases = builtConfig.d1_databases.map(binding => binding.binding === 'DB'
      ? { ...binding, database_name: 'fresh-native-migration-acceptance', database_id: '7e8f7a6b-2c3d-4e5f-9012-3456789abcde' } : binding);
    const nativeConfig = path.join(root, 'dist/ssr/migration-acceptance.wrangler.json');
    await fs.writeFile(nativeConfig, JSON.stringify(builtConfig));
    const requireWrangler = createRequire(path.join(wranglerRoot, 'package.json'));
    const hostOverrides = {
      WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false',
      WRANGLER_SEND_ERROR_REPORTS: 'false', COSSACK_DISABLE_UPDATE_CHECK: '1',
      CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_API_KEY: '', CLOUDFLARE_EMAIL: '',
      CLOUDFLARE_API_BASE_URL: 'http://127.0.0.1:1',
    };
    const priorHost = Object.fromEntries(Object.keys(hostOverrides).map(key => [key, process.env[key]]));
    Object.assign(process.env, hostOverrides);
    try {
      const { createTestHarness } = await import(pathToFileURL(requireWrangler.resolve('wrangler')).href);
      harness = createTestHarness({ root, workers: [{ configPath: nativeConfig }] });
      const { url } = await harness.listen();
      const worker = harness.getWorker();
      const { DB } = await worker.getEnv();
      const before = await DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      assert.ok(before.results.every(row => !authoredTables.has(row.name)), 'Native runtime database must start without authored schema');
      for (const statement of statements) await DB.prepare(statement.text).run();
      const response = await fetch(new URL('/api/migration-acceptance', url), { method: 'POST', signal: AbortSignal.timeout(30_000) });
      assert.equal(response.status, 200, await response.clone().text());
      assert.deepEqual(await response.json(), { userFound: true, sessionFound: true, users: 1, sessions: 1 });
      console.log('Installed generated migrations passed: seven complete read-only plans, nine zero-parameter DDL statements, strict generated types/build, native D1 User/Session inserts/finds/counts/public IDs.');
    } finally {
      for (const [key, value] of Object.entries(priorHost)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  } finally {
    await harness?.close();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  assert.ok(process.argv[2], 'Usage: node verify-generated-migration-plans.mjs INSTALLED_PROJECT [CLOUDFLARE_TOOLING_PROJECT]');
  await verifyGeneratedMigrationPlans(process.argv[2], { cloudflareTools: process.argv[3] ?? process.argv[2] });
}
