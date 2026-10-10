import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmod, mkdtemp, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const requireDatabase = createRequire(new URL('../packages/database/package.json', import.meta.url));

export async function stopOwnedProcess(child, graceMs = 10000, { processGroup = false } = {}) {
  if (!child.pid) return;
  const signal = (name) => {
    if (!processGroup) return child.kill(name);
    try {
      process.kill(-child.pid, name);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  if (child.exitCode !== null || child.signalCode !== null) {
    if (processGroup) signal('SIGKILL');
    return;
  }
  const exited = new Promise((resolve) => child.once('exit', resolve));
  signal('SIGTERM');
  let timer;
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), graceMs);
    }),
  ]);
  clearTimeout(timer);
  if (!stopped) {
    signal('SIGKILL');
    await exited;
  }
  if (processGroup) signal('SIGKILL');
  if (child.exitCode === null && child.signalCode === null) throw new Error('Owned process did not exit');
}

async function port() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const value = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return value;
}

// Requires native PostgreSQL/MySQL executables and the database optional drivers.
// Override their paths with COSSACK_POSTGRES_BIN_DIR / COSSACK_MYSQL_BINARY.
// These loopback, trust-authenticated instances are disposable local tests only.
export async function runDatabaseProviders() {
  if (process.platform === 'win32') throw new Error('Native provider acceptance requires POSIX process groups');
  const evidence = await mkdtemp(join(tmpdir(), 'cossack-provider-acceptance-'));
  const pgData = join(evidence, 'postgres-data');
  const mysqlData = join(evidence, 'mysql-data');
  await mkdir(pgData, { mode: 0o700 });
  await mkdir(mysqlData, { mode: 0o700 });
  const owned = new Set();
  const handles = [];
  let commandIndex = 0;
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    for (const child of owned) void stopOwnedProcess(child, 10000, { processGroup: true }).catch(() => {});
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  async function launch(binary, args, env = process.env) {
    if (interrupted) throw new Error('Provider acceptance interrupted');
    const log = await open(join(evidence, `${++commandIndex}-command.log`), 'w', 0o600);
    handles.push(log);
    const child = spawn(binary, args, { cwd: root, env, detached: true, stdio: ['ignore', log.fd, log.fd] });
    owned.add(child);
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    if (interrupted) {
      await stopOwnedProcess(child, 10000, { processGroup: true });
      throw new Error('Provider acceptance interrupted');
    }
    return child;
  }
  async function command(binary, args, env) {
    const child = await launch(binary, args, env);
    const timer = setTimeout(() => {
      void stopOwnedProcess(child, 0, { processGroup: true });
    }, 180000);
    const code = await new Promise((resolve) => child.once('exit', resolve));
    clearTimeout(timer);
    await stopOwnedProcess(child, 10000, { processGroup: true });
    owned.delete(child);
    if (code !== 0)
      throw new Error(`Provider acceptance command ${commandIndex} failed; private evidence: ${evidence}`);
  }
  async function ready(child, probe) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Provider exited before readiness; ${evidence}`);
      try {
        return await probe();
      } catch {
        await delay(250);
      }
    }
    throw new Error(`Provider readiness deadline exceeded; ${evidence}`);
  }
  try {
    const pgBin = process.env.COSSACK_POSTGRES_BIN_DIR || '/usr/lib/postgresql/18/bin';
    const mysqlBin = process.env.COSSACK_MYSQL_BINARY || '/usr/sbin/mysqld';
    await command(join(pgBin, 'initdb'), ['-D', pgData, '-A', 'trust', '-U', 'cossack', '--no-locale']);
    await command(mysqlBin, ['--no-defaults', '--initialize-insecure', `--datadir=${mysqlData}`]);
    const pgPort = await port();
    const pgChild = await launch(join(pgBin, 'postgres'), [
      '-D',
      pgData,
      '-h',
      '127.0.0.1',
      '-p',
      String(pgPort),
      '-k',
      evidence,
    ]);
    const mysqlPort = await port();
    const mysqlChild = await launch(mysqlBin, [
      '--no-defaults',
      `--datadir=${mysqlData}`,
      '--bind-address=127.0.0.1',
      `--port=${mysqlPort}`,
      `--socket=${join(evidence, 'mysql.sock')}`,
      `--pid-file=${join(evidence, 'mysql.pid')}`,
      '--mysqlx=0',
    ]);
    const { Client } = requireDatabase('pg');
    const mysql = requireDatabase('mysql2/promise');
    const pgUrl = `postgres://cossack@127.0.0.1:${pgPort}/postgres`;
    const mysqlBase = `mysql://root@127.0.0.1:${mysqlPort}`;
    const postgresVersion = await ready(pgChild, async () => {
      const client = new Client({ connectionString: pgUrl, connectionTimeoutMillis: 1000 });
      try {
        await client.connect();
        return (await client.query('SELECT version() AS version')).rows[0].version;
      } finally {
        await client.end();
      }
    });
    const mysqlVersion = await ready(mysqlChild, async () => {
      const client = await mysql.createConnection({ uri: mysqlBase, connectTimeout: 1000 });
      try {
        const [rows] = await client.query('SELECT VERSION() AS version');
        if (/mariadb/i.test(rows[0].version)) throw new Error('Actual MySQL is required');
        await client.query('CREATE DATABASE IF NOT EXISTS cossack_acceptance');
        return rows[0].version;
      } finally {
        await client.end();
      }
    });
    await command(
      'pnpm',
      [
        '--filter',
        '@cossackframework/database',
        'exec',
        'vitest',
        'run',
        'test/rt15-provider-acceptance.test.ts',
        '--reporter=json',
        `--outputFile=${join(evidence, 'vitest.json')}`,
      ],
      {
        ...process.env,
        COSSACK_TEST_POSTGRES_URL: pgUrl,
        COSSACK_TEST_MYSQL_URL: `${mysqlBase}/cossack_acceptance`,
      },
    );
    if (interrupted) throw new Error('Provider acceptance interrupted');
    await chmod(join(evidence, 'vitest.json'), 0o600);
    const result = JSON.parse(await readFile(join(evidence, 'vitest.json'), 'utf8'));
    if (!result.success || result.numPendingTests !== 0 || result.numPassedTests !== 6)
      throw new Error('All six actual-provider assertions must pass without skips');
    await writeFile(
      join(evidence, 'verified.json'),
      JSON.stringify(
        { postgresVersion, mysqlVersion, passed: result.numPassedTests, skipped: result.numPendingTests },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(
      `Database provider acceptance: ${result.numPassedTests} passed, no skips. PostgreSQL ${postgresVersion}; MySQL ${mysqlVersion}. Evidence: ${evidence}`,
    );
  } finally {
    const cleanup = await Promise.allSettled(
      Array.from(owned, (child) => stopOwnedProcess(child, 10000, { processGroup: true })),
    );
    await Promise.all(handles.map((handle) => handle.close()));
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    const failures = cleanup.filter((result) => result.status === 'rejected');
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        `Owned process cleanup failed; ${evidence}`,
      );
    await rm(pgData, { recursive: true, force: true });
    await rm(mysqlData, { recursive: true, force: true });
    await writeFile(
      join(evidence, 'cleaned.json'),
      JSON.stringify({ processesExited: true, dataDirectoriesRemoved: true }),
      { mode: 0o600 },
    );
    console.log(`Owned PostgreSQL/MySQL processes exited and private data directories removed: ${evidence}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runDatabaseProviders();
}
