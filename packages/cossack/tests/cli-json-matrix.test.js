import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '@cossackframework/scaffold';

const bin = fileURLToPath(new URL('../bin/cossack.js', import.meta.url));
const require = createRequire(import.meta.url);
let root;
let children;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack machine matrix '));
  children = new Set();
  await fs.writeFile(path.join(root, 'package.json'), '{}');
});
afterEach(async () => {
  for (const child of children) child.kill('SIGTERM');
  await fs.rm(root, { recursive: true, force: true });
});

function execute(argv, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...argv], {
      cwd: options.cwd ?? root, env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    let stdout = '', stderr = '', stopped = false;
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('CLI matrix deadline')); }, options.timeout ?? 20000);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (options.stopOnStarted && !stopped && stdout.split('\n').some(line => {
        try { return JSON.parse(line).data?.event === 'started'; } catch { return false; }
      })) { stopped = true; setTimeout(() => child.kill('SIGTERM'), options.stopDelay ?? 0); }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer); children.delete(child);
      resolve({ code, stdout, stderr });
    });
  });
}
function envelope(result, command, ok = true) {
  expect(result.stderr).toBe('');
  expect(result.code).toBe(ok ? 0 : 1);
  const lines = result.stdout.trim().split('\n');
  expect(lines, result.stdout).toHaveLength(1);
  const data = JSON.parse(lines[0]);
  expect(data).toMatchObject({ schemaVersion: 1, command, ok, diagnostics: expect.any(Array) });
  expect(result.stdout).not.toContain('private-value');
  return data;
}
async function application(features = []) {
  const project = await createApp('app', { cwd: root, adapter: 'node', features,
    preset: 'minimal', interactive: false });
  await fs.writeFile(path.join(project.projectDir, '.env'), 'APP_SECRET=environment-private-value\n');
  return project.projectDir;
}
async function snapshot(directory) {
  const files = {};
  async function visit(current, prefix = '') {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const target = path.join(current, entry.name);
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await visit(target, relative + '/');
      else files[relative] = await fs.readFile(target, 'base64');
    }
  }
  await visit(directory);
  return files;
}
async function orm() {
  await fs.mkdir(path.join(root, 'node_modules/@cossackframework'), { recursive: true });
  await fs.symlink(fileURLToPath(new URL('../../database/', import.meta.url)),
    path.join(root, 'node_modules/@cossackframework/database'), 'junction');
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module',
    dependencies: { '@cossackframework/database': '^0.9.0' } }));
  await fs.writeFile(path.join(root, 'orm.config.ts'), `
import { defineConfig } from '@cossackframework/database';
import { MemoryDriver } from '@cossackframework/database/adapter';
console.log('config-private-value');
if (process.env.COSSACK_FIXTURE_FAILURE_MODE === 'config') throw new Error('config-private-value');
export default defineConfig({
  entities: [],
  adapter(context) {
    if (process.env.COSSACK_FIXTURE_FAILURE_MODE === 'factory') throw new Error('factory-private-value');
    const driver = new MemoryDriver();
    driver.close = async () => {
      if (process.env.COSSACK_FIXTURE_FAILURE_MODE === 'close') throw new Error('close-private-value');
    };
    return { driver, tooling: { provider: 'fixture', target: context.target, accidentalSecret: 'metadata-private-value' } };
  },
  migrations: [{ name: '001_fixture', up() {
    if (process.env.COSSACK_FIXTURE_FAILURE_MODE === 'operation') throw new Error('migration-private-value');
  }, down() {} }],
  seeds: [{ name: 'fixture', run() {
    if (process.env.COSSACK_FIXTURE_FAILURE_MODE === 'operation') throw new Error('seeder-private-value');
  } }],
});
`);
}
async function cloudflare(config = {}) {
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.symlink(path.dirname(require.resolve('wrangler/package.json')), path.join(root, 'node_modules/wrangler'), 'junction');
  await fs.writeFile(path.join(root, 'worker.ts'), 'export default { fetch: () => new Response("ok") };');
  await fs.writeFile(path.join(root, 'wrangler.jsonc'), JSON.stringify({
    name: 'matrix', main: './worker.ts', compatibility_date: '2026-06-06',
    vars: { APP_URL: 'https://matrix.test' }, ...config,
  }));
}

async function projectTooling(source) {
  const directory = path.join(root, 'node_modules/@cossackframework/database');
  await fs.mkdir(path.join(directory, 'dist/tooling'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module',
    dependencies: { '@cossackframework/database': '^0.9.0' } }));
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ type: 'module',
    exports: { './package.json': './package.json' } }));
  await fs.writeFile(path.join(directory, 'dist/tooling/index.js'), source);
}

describe('finite command success / failure / dry-run matrix', () => {
  it('create plans without writes, applies without prompts, and reports existing destinations', async () => {
    envelope(await execute(['create', 'app', '--adapter=node', '--preset=minimal', '--dry-run', '--json']), 'create');
    expect(await fs.readdir(root)).toEqual(['package.json']);
    envelope(await execute(['create', 'app', '--adapter=node', '--preset=minimal', '--json']), 'create');
    expect(await fs.readFile(path.join(root, 'app/package.json'), 'utf8')).toContain('"name": "app"');
    envelope(await execute(['create', 'app', '--adapter=node', '--preset=minimal', '--json']), 'create', false);
  });

  it('add/remove plan identical files and apply without prompts or secret values', async () => {
    const cwd = await application();
    const before = await snapshot(cwd);
    const planned = envelope(await execute(['add', 'ui', '--dry-run', '--json'], { cwd }), 'add');
    expect(planned.data.effects.some(effect => effect.action === 'planned')).toBe(true);
    expect(await snapshot(cwd)).toEqual(before);
    envelope(await execute(['add', 'ui', '--json'], { cwd }), 'add');
    const installed = await snapshot(cwd);
    expect(installed).not.toEqual(before);
    const removing = envelope(await execute(['remove', 'ui', '--dry-run', '--json'], { cwd }), 'remove');
    expect(removing.data.effects.some(effect => effect.action === 'planned-delete')).toBe(true);
    expect(await snapshot(cwd)).toEqual(installed);
    envelope(await execute(['remove', 'ui', '--json'], { cwd }), 'remove');
    expect(await fs.readFile(path.join(cwd, '.env'), 'utf8')).toContain('environment-private-value');
    expect(envelope(await execute(['remove', 'ui', '--json']), 'remove').data.status).toBe('absent');
    envelope(await execute(['add', 'ui', '--json'], { cwd }), 'add');
    const manifest = JSON.parse(await fs.readFile(path.join(cwd, '.cossack/scaffold.json'), 'utf8'));
    const ownedUI = Object.entries(manifest.files).find(([, ownership]) => ownership.capability === 'ui')[0];
    await fs.appendFile(path.join(cwd, ownedUI), '\n/* local edit */\n');
    const modified = await snapshot(cwd);
    const bad = envelope(await execute(['remove', 'ui', '--json'], { cwd }), 'remove', false);
    expect(bad.diagnostics[0].code).toBe('COSSACK_FEATURE_REMOVE_FAILED');
    expect(await snapshot(cwd)).toEqual(modified);
  }, 30_000); // Multiple real CLI subprocesses and whole-project snapshots.

  it('generate/delete plan and apply affected paths', async () => {
    const cwd = await application();
    const before = await snapshot(cwd);
    const planned = envelope(await execute(['generate', 'component', 'Badge', '--dry-run', '--json'], { cwd }), 'generate');
    expect(planned.data.effects).toContainEqual({ action: 'planned', path: 'src/components/Badge.ts' });
    expect(await snapshot(cwd)).toEqual(before);
    envelope(await execute(['generate', 'component', 'Badge', '--json'], { cwd }), 'generate');
    const generated = await snapshot(cwd);
    envelope(await execute(['delete', 'component', 'Badge', '--dry-run', '--json'], { cwd }), 'delete');
    expect(await snapshot(cwd)).toEqual(generated);
    envelope(await execute(['delete', 'component', 'Badge', '--json'], { cwd }), 'delete');
    expect(await snapshot(cwd)).toEqual(before);
    envelope(await execute(['delete', 'component', 'Badge', '--json'], { cwd }), 'delete', false);
  });

  it('lang publishes and adds catalogs, and formats the default-locale failure', async () => {
    const cwd = await application();
    const before = await snapshot(cwd);
    envelope(await execute(['lang', 'publish', '--dry-run', '--json'], { cwd }), 'lang');
    expect(await snapshot(cwd)).toEqual(before);
    envelope(await execute(['lang', 'publish', '--json'], { cwd }), 'lang');
    envelope(await execute(['lang', 'add', 'es', '--json'], { cwd }), 'lang');
    expect(JSON.parse(await fs.readFile(path.join(cwd, 'src/lang/es.json'), 'utf8'))).toHaveProperty('welcome');
    const failed = envelope(await execute(['lang', 'add', 'en', '--json'], { cwd }), 'lang', false);
    expect(failed.diagnostics[0].code).toBe('COSSACK_LOCALE_DEFAULT');
  });

  it.each(['build', 'ssg'])('%s isolates successful project output', async command => {
    const tools = path.join(root, 'tools');
    await fs.mkdir(tools);
    await fs.writeFile(path.join(tools, 'vite'), '#!/usr/bin/env node\nconsole.log("build-private-value"); console.error("build-private-value");', { mode: 0o755 });
    const result = envelope(await execute([command, '--json'], { env: { PATH: tools + path.delimiter + process.env.PATH } }), command);
    expect(result.data.exitCode).toBe(0);
  });

  it.each(['inspect', 'check'])('%s cloudflare hides vars and reports malformed config without excerpts', async command => {
    await cloudflare({ vars: { APP_SECRET: 'config-private-value' } });
    const before = await snapshot(root);
    const inspected = envelope(await execute([command, 'cloudflare', '--json']), command, command === 'inspect');
    expect(inspected.diagnostics.some(d => d.code === 'COSSACK_SECRET_IN_VARS')).toBe(true);
    expect(await snapshot(root)).toEqual(before);
    await fs.writeFile(path.join(root, 'wrangler.jsonc'), '{"APP_SECRET":"parser-private-value"');
    const bad = envelope(await execute([command, 'cloudflare', '--json']), command, false);
    expect(bad.diagnostics[0].code).toBe('COSSACK_WRANGLER_CONFIG_INVALID');
  });

  it.each(['inspect', 'check'])('%s cloudflare succeeds with valid local configuration', async command => {
    await cloudflare();
    const result = envelope(await execute([command, 'cloudflare', '--json']), command);
    expect(result.data.worker).toBe('matrix');
    expect(result.data.readiness.remote).toBe('not-checked');
  });

  it('deploy reports missing configuration and never uploads after failure', async () => {
    const result = envelope(await execute(['deploy', '--dry-run', '--json']), 'deploy', false);
    expect(result.diagnostics[0].code).toBe('COSSACK_WRANGLER_CONFIG_MISSING');
  });

  it('deploy completes actual local Wrangler type generation and artifact dry-run with one envelope', async () => {
    await cloudflare();
    const vite = path.join(root, 'node_modules/vite'); await fs.mkdir(vite);
    await fs.writeFile(path.join(vite, 'package.json'), JSON.stringify({ name: 'vite', bin: './bin.cjs' }));
    await fs.writeFile(path.join(vite, 'bin.cjs'), `
      const fs = require('node:fs'); const path = require('node:path');
      console.log('vite-private-value'); console.error('vite-private-value');
      const config = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
      fs.mkdirSync('dist', { recursive: true });
      fs.writeFileSync('dist/worker.js', 'export default { fetch: () => new Response("ok") };');
      fs.writeFileSync('dist/wrangler.jsonc', JSON.stringify({ ...config, main: path.resolve('dist/worker.js') }));
      fs.mkdirSync('.wrangler/deploy', { recursive: true });
      fs.writeFileSync('.wrangler/deploy/config.json', JSON.stringify({ configPath: '../../dist/wrangler.jsonc' }));
    `);
    const result = envelope(await execute(['deploy', '--dry-run', '--json'], { timeout: 60000,
      env: { WRANGLER_SEND_METRICS: 'false' } }), 'deploy');
    expect(result.data.dryRun).toBe(true);
    expect(result.data.steps.map(step => step.name)).toEqual(['types', 'build', 'deploy']);
    expect(result.data.artifact).toBe(path.join(root, 'dist/wrangler.jsonc'));
    expect(await fs.readFile(path.join(root, 'worker-configuration.d.ts'), 'utf8')).toContain('CloudflareBindings');
  }, 60000);

  it('image conversion records created files and never includes converter logs', async () => {
    await fs.mkdir(path.join(root, 'src')); await fs.mkdir(path.join(root, 'public'));
    await fs.writeFile(path.join(root, 'src/page.ts'), "Image({ src: '/photo.png', width: 200 });");
    await fs.writeFile(path.join(root, 'public/photo.png'), 'source');
    const tools = path.join(root, 'tools'); await fs.mkdir(tools);
    await fs.writeFile(path.join(tools, 'magick'), '#!/usr/bin/env node\n' +
      'console.log("converter-private-value"); if(process.argv[2] !== "--version") ' +
      'require("node:fs").writeFileSync(process.argv.at(-1).replace(/^webp:/, ""), "converted");', { mode: 0o755 });
    const result = envelope(await execute(['image', 'optimize', '--json'], {
      env: { PATH: tools + path.delimiter + process.env.PATH },
    }), 'image');
    expect(result.data.optimized).toBe(1);
    const effect = result.data.effects.find(effect => effect.action === 'created');
    expect(await fs.readFile(path.join(root, effect.path), 'utf8')).toBe('converted');
  });

  it.each([
    ['migration', 'status'], ['schema', 'diff'], ['seeder', 'list'], ['seeder', 'run'],
  ])('%s %s returns the canonical public command through real noisy ORM tooling', async (command, action) => {
    await orm();
    const result = envelope(await execute([command, action, '--json']), command);
    expect(result.data.action).toBe(action);
  });

  it.each([
    ['migration', 'up'], ['migration', 'snapshot'], ['migration', 'squash', 'baseline'],
    ['schema', 'pull'], ['seeder', 'run'],
  ])('%s %s dry-run preserves files through actual ORM code', async (...args) => {
    await orm();
    const before = await snapshot(root);
    const result = envelope(await execute([...args, '--dry-run', '--json']), args[0]);
    expect(result.data.dryRun).toBe(true);
    expect(await snapshot(root)).toEqual(before);
  });

  it.each([
    ['migration', 'plan', 'config', 'configuration'],
    ['migration', 'plan', 'factory', 'connection'],
    ['migration', 'up', 'operation', 'operation'],
    ['seeder', 'run', 'operation', 'operation'],
    ['schema', 'diff', 'close', 'cleanup'],
  ])('%s %s failures hide project exception values and identify phase %s', async (command, action, mode, phase) => {
    await orm();
    const result = envelope(await execute([command, action, '--json'], {
      env: { COSSACK_FIXTURE_FAILURE_MODE: mode },
    }), command, false);
    expect(result.data.phase).toBe(phase);
    expect(result.data.nextActions).toHaveLength(1);
  });

  it.each(['add', 'remove', 'adapter'])('%s hides malformed package parser excerpts', async command => {
    const cwd = await application(['ui']);
    await fs.writeFile(path.join(cwd, 'package.json'), '{"APP_SECRET":"parser-private-value"');
    envelope(await execute([command, command === 'adapter' ? 'cloudflare' : 'ui', '--json'], { cwd }), command, false);
  });

  it('top-level help/version and option errors use the same machine contract', async () => {
    expect(envelope(await execute(['--help', '--json']), 'cossack').data.help).toContain('cossack <command>');
    expect(envelope(await execute(['--version', '--json']), 'version').data.version).toMatch(/^\d/);
    envelope(await execute(['--version', '--typo', '--json']), 'version', false);
    expect(envelope(await execute(['unknown:action', '--json']), 'unknown:action', false)
      .diagnostics[0].code).toBe('COSSACK_COMMAND_UNKNOWN');
  });

  it('info excludes noisy package-manager version output', async () => {
    const tools = path.join(root, 'tools'); await fs.mkdir(tools);
    for (const name of ['npm', 'pnpm']) await fs.writeFile(path.join(tools, name),
      '#!/usr/bin/env node\nconsole.log("manager-private-value"); console.error("manager-private-value");', { mode: 0o755 });
    const result = envelope(await execute(['info', '--json'], {
      env: { PATH: tools + path.delimiter + process.env.PATH },
    }), 'info');
    expect(result.data.packageManager).toEqual({ npm: '(unavailable)', pnpm: '(unavailable)' });
  });

  it('isolates top-level ORM package logs before its own JSON tooling starts', async () => {
    await projectTooling(`
      console.log('import-private-value'); console.error('import-private-value');
      export async function runORMCommand(argv, options) {
        options.stdout('callback-private-value'); options.stderr('callback-private-value');
        options.stdout(JSON.stringify({ schemaVersion: 1, command: 'migration', action: 'status',
          ok: true, data: { migrations: [] }, diagnostics: [] })); return 0;
      }
    `);
    const result = envelope(await execute(['migration', 'status', '--json']), 'migration');
    expect(result.data).toEqual({ action: 'status', migrations: [] });
  });

  it.each(['missing', 'duplicate', 'diagnostics', 'exit'])('rejects %s ORM results with a structured failure', async mode => {
    await projectTooling(`
      export async function runORMCommand(argv, options) {
        const mode = ${JSON.stringify(mode)};
        const result = { schemaVersion: 1, command: 'migration', ok: true, data: {},
          diagnostics: mode === 'diagnostics' ? [{}] : [] };
        if (mode !== 'missing') options.stdout(JSON.stringify(result));
        if (mode === 'duplicate') options.stdout(JSON.stringify(result));
        return mode === 'exit' ? 1 : 0;
      }
    `);
    const result = envelope(await execute(['migration', 'status', '--json']), 'migration', false);
    expect(result.diagnostics[0].code).toBe('COSSACK_ORM_RESULT_INVALID');
  });

  it('invalid execution deadlines fail before creating a project', async () => {
    const result = envelope(await execute(['create', 'app', '--json'], {
      env: { COSSACK_COMMAND_TIMEOUT_MS: 'deadline-private-value' },
    }), 'create', false);
    expect(result.diagnostics[0].code).toBe('COSSACK_TIMEOUT_INVALID');
    expect(await fs.readdir(root)).toEqual(['package.json']);
  });
});

describe('lifecycle process event contract', () => {
  it.each(['dev', 'start'])('%s emits started/stopped events and reclaims its process on cancellation', async command => {
    let env = {};
    if (command === 'start') {
      await fs.mkdir(path.join(root, 'dist/server'), { recursive: true });
      await fs.writeFile(path.join(root, 'dist/server/index.js'),
        'require("node:fs").writeFileSync("started.txt", "yes"); console.log("server-private-value"); setInterval(() => {}, 10000);');
    } else {
      const tools = path.join(root, 'tools'); await fs.mkdir(tools);
      await fs.writeFile(path.join(tools, 'vite'), '#!/usr/bin/env node\nrequire("node:fs").writeFileSync("started.txt", "yes"); console.log("vite-private-value"); setInterval(() => {}, 10000);', { mode: 0o755 });
      env = { PATH: tools + path.delimiter + process.env.PATH };
    }
    const result = await execute([command, '--json'], { stopOnStarted: true, stopDelay: 500, env });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('private-value');
    const events = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(events.map(e => e.data.event)).toEqual(['started', 'stopped']);
    expect(events.every(e => e.schemaVersion === 1 && e.command === command && e.ok)).toBe(true);
    expect(await fs.readFile(path.join(root, 'started.txt'), 'utf8')).toBe('yes');
    expect(() => process.kill(events[0].data.pid, 0)).toThrow();
  });

  it('bounds shutdown of a running server that ignores termination', async () => {
    await fs.mkdir(path.join(root, 'dist/server'), { recursive: true });
    await fs.writeFile(path.join(root, 'dist/server/index.js'),
      'process.on("SIGTERM", () => {}); require("node:fs").writeFileSync("started.txt", "yes"); setInterval(() => {}, 10000);');
    const result = await execute(['start', '--json'], { stopOnStarted: true, stopDelay: 500 });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    const events = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(events.map(e => e.data.event)).toEqual(['started', 'failed']);
    expect(events[1].diagnostics[0].code).toBe('COSSACK_COMMAND_SHUTDOWN_TIMEOUT');
    expect(await fs.readFile(path.join(root, 'started.txt'), 'utf8')).toBe('yes');
    expect(() => process.kill(events[0].data.pid, 0)).toThrow();
  }, 10000);

  it('supervises premature project termination and emits one failed envelope', async () => {
    await projectTooling('console.log("exit-private-value"); process.exit(0);');
    const result = envelope(await execute(['migration', 'plan', '--json']), 'migration', false);
    expect(result.diagnostics[0].code).toBe('COSSACK_COMMAND_PROCESS_FAILED');
  });

  it('bounds a hung project import and reclaims descendants without raw output', async () => {
    await orm();
    await fs.writeFile(path.join(root, 'orm.config.ts'),
      'console.log("hang-private-value"); setInterval(() => {}, 10000); await new Promise(() => {});');
    const result = envelope(await execute(['migration', 'plan', '--json'], {
      env: { COSSACK_COMMAND_TIMEOUT_MS: '1500' },
    }), 'migration', false);
    expect(result.diagnostics[0].code).toBe('COSSACK_COMMAND_TIMEOUT');
  });
});
