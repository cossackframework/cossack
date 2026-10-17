// `pnpm test:databases`: the live PostgreSQL, MySQL and FastDB suites, run
// locally before a release (docs/testing.md).
//
// The FastDB client and CMS suites start `fastdb serve` themselves. They need a
// FastDB 2.8.0+ executable: set COSSACK_TEST_FASTDB_BIN or put `fastdb` on PATH.
//
// With COSSACK_TEST_POSTGRES_URL and COSSACK_TEST_MYSQL_URL both set, the
// suites use those databases. Otherwise this script starts the pinned
// PostgreSQL and MySQL images with Docker on free loopback ports, waits until
// both accept connections, and always removes the containers afterwards, also
// after a failure or Ctrl+C.
//
// Then, with COSSACK_TEST_REQUIRE_LIVE=1 so that nothing skips for a missing
// URL, it builds the workspace and runs the database tests, the Studio live
// introspection tests and the Studio MySQL browser test. It runs every suite
// and exits non-zero if any of them fails.
//
// Options: --no-build skips `pnpm build` when the packages are already built.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { stopOwnedProcess } from './test-database-providers.mjs';

// Pinned by tag and multi-arch index digest. Update both together:
// docker buildx imagetools inspect postgres:18.x / mysql:8.0.x
export const POSTGRES_IMAGE =
  'postgres:18.6@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336';
export const MYSQL_IMAGE =
  'mysql:8.0.46@sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b';

const root = fileURLToPath(new URL('../', import.meta.url));
const requireDatabase = createRequire(new URL('../packages/database/package.json', import.meta.url));
const processGroups = process.platform !== 'win32';
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const SUITES = [
  {
    name: 'database tests',
    args: ['--filter', '@cossackframework/database', 'run', 'test', '--watch=false'],
  },
  {
    name: 'Studio live introspection tests',
    args: ['--filter', '@cossackframework/studio', 'run', 'test', '--watch=false', 'tests/live-introspection.test.ts'],
  },
  {
    name: 'FastDB client tests',
    args: ['--filter', '@cossackframework/fastdb', 'run', 'test', '--watch=false'],
  },
  {
    name: 'CMS tests',
    args: ['--filter', '@cossackframework/cms', 'run', 'test', '--watch=false'],
  },
  {
    name: 'Studio MySQL definition browser test',
    args: ['--filter', '@cossackframework/studio', 'exec', 'playwright', 'test', 'e2e/mysql-definition.spec.ts'],
  },
];

const log = (message) => console.log(`[test:databases] ${message}`);
const fail = (message) => console.error(`[test:databases] ${message}`);

class Interrupted extends Error {}

let interrupted;
let current;

function onSignal(signal) {
  if (interrupted) return;
  interrupted = signal;
  fail(`${signal} received: stopping and removing the database containers.`);
  if (current) void stopOwnedProcess(current, 10_000, { processGroup: processGroups }).catch(() => {});
}

function checkInterrupted() {
  if (interrupted) throw new Interrupted(`Interrupted by ${interrupted}`);
}

/**
 * Run a command. `capture` collects stdout and stderr; otherwise the output
 * goes to this terminal. `owned` runs it in its own process group, which a
 * signal stops as a whole. Commands never read the terminal: a process outside
 * the foreground group that touches it would stop.
 */
function run(command, args, { capture = false, env = process.env, owned = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
      detached: owned && processGroups,
    });
    if (owned) current = child;
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      if (current === child) current = undefined;
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (current === child) current = undefined;
      resolve({ code: code ?? (signal ? 1 : 0), stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function docker(args) {
  const result = await run('docker', args, { capture: true }).catch((error) => ({
    code: 1,
    stdout: '',
    stderr: error.code === 'ENOENT' ? 'the docker command is not installed' : error.message,
  }));
  return result;
}

async function requireDocker() {
  const result = await docker(['info', '--format', '{{.ServerVersion}}']);
  if (result.code === 0) return;
  throw new Error(
    `Docker is not available (${result.stderr.split('\n')[0] || `exit ${result.code}`}).\n` +
    'Start Docker, or set COSSACK_TEST_POSTGRES_URL and COSSACK_TEST_MYSQL_URL to two disposable databases.',
  );
}

async function ensureImage(image) {
  checkInterrupted();
  if ((await docker(['image', 'inspect', image])).code === 0) return;
  log(`pulling ${image}`);
  const result = await run('docker', ['pull', image]);
  checkInterrupted();
  if (result.code !== 0) throw new Error(`docker pull ${image} failed with exit code ${result.code}`);
}

/** Start a container with a health check and return its published host port. */
async function startContainer(containers, { name, image, port, env, healthCommand }) {
  await ensureImage(image);
  checkInterrupted();
  containers.push(name);
  log(`starting ${image.split('@')[0]} as ${name}`);
  const result = await run('docker', [
    'run', '--detach', '--name', name,
    '--label', 'cossack.test-databases=1',
    '--publish', `127.0.0.1::${port}`,
    ...Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    '--health-cmd', healthCommand,
    '--health-interval', '2s',
    '--health-timeout', '5s',
    '--health-retries', '60',
    image,
  ], { capture: true });
  checkInterrupted();
  if (result.code !== 0) throw new Error(`docker run ${name} failed:\n${result.stderr}`);
  const published = await docker(['port', name, `${port}/tcp`]);
  const hostPort = published.stdout.match(/:(\d+)\s*$/m)?.[1];
  if (!hostPort) throw new Error(`Docker did not publish port ${port} of ${name}: ${published.stderr || published.stdout}`);
  return Number(hostPort);
}

async function waitForHealthy(name, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    checkInterrupted();
    const state = await docker(['inspect', '--format', '{{.State.Status}} {{.State.Health.Status}}', name]);
    const [status, health] = state.stdout.split(' ');
    if (health === 'healthy') return;
    if (status === 'exited' || status === 'dead' || health === 'unhealthy') {
      const logs = await docker(['logs', '--tail', '40', name]);
      throw new Error(`${name} did not start (${status}, ${health}):\n${logs.stdout}\n${logs.stderr}`);
    }
    await delay(1_000);
  }
  throw new Error(`${name} was not healthy after ${timeoutMs / 1000} seconds`);
}

/** Wait until the server answers a query through the published port. */
async function waitForQuery(label, query, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    checkInterrupted();
    try {
      return await query();
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }
  throw new Error(`${label} did not accept connections: ${lastError?.message ?? 'timed out'}`);
}

async function probe(urls) {
  const { Client } = requireDatabase('pg');
  const mysql = requireDatabase('mysql2/promise');
  const postgresVersion = await waitForQuery('PostgreSQL', async () => {
    const client = new Client({ connectionString: urls.postgres, connectionTimeoutMillis: 2_000 });
    try {
      await client.connect();
      return (await client.query('SHOW server_version')).rows[0].server_version;
    } finally {
      await client.end().catch(() => {});
    }
  });
  const mysqlVersion = await waitForQuery('MySQL', async () => {
    const client = await mysql.createConnection({ uri: urls.mysql, connectTimeout: 2_000 });
    try {
      const [rows] = await client.query('SELECT VERSION() AS version');
      return rows[0].version;
    } finally {
      await client.end().catch(() => {});
    }
  });
  log(`PostgreSQL ${postgresVersion}, MySQL ${mysqlVersion}`);
}

async function startDatabases(containers) {
  await requireDocker();
  const suffix = randomBytes(4).toString('hex');
  const postgresName = `cossack-test-postgres-${suffix}`;
  const mysqlName = `cossack-test-mysql-${suffix}`;
  const postgresPort = await startContainer(containers, {
    name: postgresName,
    image: POSTGRES_IMAGE,
    port: 5432,
    env: { POSTGRES_USER: 'cossack', POSTGRES_PASSWORD: 'cossack', POSTGRES_DB: 'cossack_test' },
    // Over TCP: the image's initialization server listens on the socket only.
    healthCommand: 'pg_isready -U cossack -d cossack_test -h 127.0.0.1',
  });
  const mysqlPort = await startContainer(containers, {
    name: mysqlName,
    image: MYSQL_IMAGE,
    port: 3306,
    // A non-UTC server: the MySQL adapter must still read and write UTC.
    env: { MYSQL_ROOT_PASSWORD: 'cossack', MYSQL_DATABASE: 'cossack_test', TZ: 'Asia/Bangkok' },
    // Over TCP: the image's initialization server runs with --skip-networking.
    healthCommand: 'mysqladmin ping -h 127.0.0.1 -pcossack',
  });
  return {
    postgres: `postgres://cossack:cossack@127.0.0.1:${postgresPort}/cossack_test`,
    mysql: `mysql://root:cossack@127.0.0.1:${mysqlPort}/cossack_test`,
    wait: async () => {
      await waitForHealthy(postgresName);
      await waitForHealthy(mysqlName);
    },
  };
}

/** Remove the containers; false when Docker could not remove them. */
async function removeContainers(containers) {
  if (!containers.length) return true;
  log(`removing ${containers.join(', ')}`);
  // -v also removes the anonymous data volumes both images declare.
  const result = await docker(['rm', '--force', '--volumes', ...containers]);
  if (result.code !== 0 && !/No such container/i.test(result.stderr)) {
    fail(`could not remove the containers, remove them with: docker rm -f -v ${containers.join(' ')}\n${result.stderr}`);
    return false;
  }
  return true;
}

async function main() {
  const build = !process.argv.includes('--no-build');
  const containers = [];
  const results = [];
  let failed = false;
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, onSignal);
  try {
    const presetPostgres = process.env.COSSACK_TEST_POSTGRES_URL;
    const presetMysql = process.env.COSSACK_TEST_MYSQL_URL;
    let urls;
    if (presetPostgres && presetMysql) {
      log('using COSSACK_TEST_POSTGRES_URL and COSSACK_TEST_MYSQL_URL');
      urls = { postgres: presetPostgres, mysql: presetMysql, wait: async () => {} };
    } else {
      if (presetPostgres || presetMysql) {
        log('only one of COSSACK_TEST_POSTGRES_URL and COSSACK_TEST_MYSQL_URL is set; starting both servers with Docker instead');
      }
      urls = await startDatabases(containers);
    }
    // Build while the containers initialize.
    if (build) {
      log('building the workspace (pass --no-build to skip)');
      const result = await run(pnpm, ['build'], { owned: true });
      checkInterrupted();
      if (result.code !== 0) throw new Error(`pnpm build failed with exit code ${result.code}`);
    }
    await urls.wait();
    await probe(urls);
    const env = {
      ...process.env,
      COSSACK_TEST_REQUIRE_LIVE: '1',
      COSSACK_TEST_POSTGRES_URL: urls.postgres,
      COSSACK_TEST_MYSQL_URL: urls.mysql,
    };
    for (const suite of SUITES) {
      checkInterrupted();
      log(`running the ${suite.name}`);
      const result = await run(pnpm, suite.args, { env, owned: true });
      checkInterrupted();
      results.push({ name: suite.name, code: result.code });
    }
  } catch (error) {
    failed = true;
    if (!(error instanceof Interrupted)) fail(error instanceof Error ? error.message : String(error));
  } finally {
    if (!(await removeContainers(containers))) failed = true;
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(signal, onSignal);
  }
  for (const result of results) {
    log(`${result.name}: ${result.code === 0 ? 'passed' : `failed (exit ${result.code})`}`);
  }
  if (interrupted) return 130;
  if (failed || results.length !== SUITES.length || results.some((result) => result.code !== 0)) {
    fail('the live database suites failed');
    return 1;
  }
  log('all live database suites passed');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
