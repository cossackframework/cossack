// A CMS application from packed tarballs, on both adapters. The repository's own suites link
// workspace packages into a hoisted layout, which hides what strict resolution and dependency
// pre-bundling break: a package an application must list itself, a second copy of RomeDB's value
// classes, or a type that only resolves because the repository installed it.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SECRET = 'packed-cms-check-secret-0123456789abcdef';
const WAIT = 120_000;
const FAILURES = ['unsupported parameter value', '[object Object]', 'Cannot find package', 'Cannot find module'];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Start a server in its own process group, read `url` once it answers, and always stop the group. */
async function page(label, command, args, { cwd, env = {}, url }) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const stop = signal => { try { process.kill(-child.pid, signal); } catch { /* it has exited */ } };
  try {
    const deadline = Date.now() + WAIT;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`${label} exited with ${child.exitCode}:\n${output.slice(-2000)}`);
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) }).catch(() => null);
      if (response) {
        const text = await response.text();
        if (response.status !== 200) throw new Error(`${label} answered ${response.status}: ${text.slice(0, 500)}\n${output.slice(-2000)}`);
        for (const failure of FAILURES) if (text.includes(failure) || output.includes(failure)) throw new Error(`${label} shows "${failure}":\n${output.slice(-2000)}`);
        console.log(`${label}: ${url} answered 200, ${text.length} bytes.`);
        return;
      }
      if (Date.now() > deadline) throw new Error(`${label} did not answer ${url}:\n${output.slice(-2000)}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } finally {
    stop('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 1500));
    stop('SIGKILL');
  }
}

/** Node lists both RomeDB packages at one version; Workers have only the client, without the addon. */
async function verifyRomeDBPackages(project, adapter) {
  const installed = (await fs.readdir(path.join(project, 'node_modules/.pnpm'))).filter(name => name.startsWith('@romedb+'));
  const expected = adapter === 'node' ? ['@romedb+client', '@romedb+node'] : ['@romedb+client'];
  if (JSON.stringify(installed.map(name => name.split('@').slice(0, 2).join('@')).sort()) !== JSON.stringify(expected)) {
    throw new Error(`${adapter} installed ${installed.join(', ')}; expected one each of ${expected.join(', ')}.`);
  }
}

/** The embedded client refuses values made by a second copy of the classes. */
async function verifyValueClasses(project, run) {
  const script = `
    import { Record } from '@romedb/client/values';
    import { Record as FromNode } from '@romedb/node/values';
    import { openEmbedded } from '@romedb/node/embedded-client';
    if (Record !== FromNode) throw new Error('Two copies of RomeDB value classes are installed.');
    const db = await openEmbedded({ path: ${JSON.stringify(path.join(project, 'values.romedb'))}, create: true });
    await db.writeAtomic([{ sql: 'CREATE TABLE t (id TEXT PRIMARY KEY, ref ANY)' }]);
    await db.writeAtomic([{ sql: 'INSERT INTO t (id, ref) VALUES ($id, $ref)', params: { $id: 'a', $ref: new Record('posts', 'p1') } }]);
    await db.close();
  `;
  await run(process.execPath, ['--input-type=module', '-e', script], { cwd: project });
}

async function verifyWorkerBundle(project) {
  const scripts = [];
  const walk = async directory => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (/\.(?:js|mjs)$/.test(entry.name)) scripts.push(file);
    }
  };
  await walk(path.join(project, 'dist/ssr'));
  for (const file of scripts) {
    const source = await fs.readFile(file, 'utf8');
    if (source.includes('romedb.node') || source.includes('embedded-client')) throw new Error(`${file} holds RomeDB's native client.`);
  }
}

export async function verifyCmsApplications(temporaryRoot, tarballs, { run, useTarballs, install }) {
  const cli = path.join(repository, 'packages/cossack/bin/cossack.js');
  for (const adapter of ['node', 'cloudflare']) {
    const name = `cms-${adapter}`;
    const project = path.join(temporaryRoot, name);
    await run(process.execPath, [cli, 'create', name, `--adapter=${adapter}`, '--preset=minimal', '--features=cms', '--yes'], { cwd: temporaryRoot });
    await useTarballs(project, tarballs);
    await install(project);
    await verifyRomeDBPackages(project, adapter);
    await run('pnpm', ['run', 'typecheck'], { cwd: project });
    await run('pnpm', ['run', 'build'], { cwd: project });

    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const dev = ['exec', 'vite', 'dev', '--port', String(port), '--strictPort', '--host', '127.0.0.1'];
    if (adapter === 'node') {
      await verifyValueClasses(project, run);
      const url = `${origin}/auth/setup`;
      const env = { APP_SECRET: SECRET, APP_URL: origin, CMS_SETUP_CODE: 'packed-check', ROMEDB_TOKEN: '' };
      await page('Node production server', process.execPath, ['--env-file-if-exists=.env', 'dist/server/index.js'], {
        cwd: project, url, env: { ...env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', ROMEDB_URL: path.join(project, 'storage/romedb/production.romedb') },
      });
      await page('Node development server', 'pnpm', dev, { cwd: project, url, env });
    } else {
      await verifyWorkerBundle(project);
      // Workers development runs `romedb serve` for its loopback database.
      if (spawnSync('romedb', ['--version']).status !== 0) {
        console.log('Skipping the Workers development server: no romedb executable on PATH.');
        continue;
      }
      const vars = path.join(project, '.dev.vars');
      const databasePort = await freePort();
      await fs.writeFile(vars, (await fs.readFile(vars, 'utf8')).replace(/^ROMEDB_URL=.*$/m, `ROMEDB_URL=http://127.0.0.1:${databasePort}`));
      await page('Workers development server', 'pnpm', dev, { cwd: project, url: `${origin}/auth/setup` });
    }
  }
}
