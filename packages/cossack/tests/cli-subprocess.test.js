import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '@cossackframework/scaffold';

const bin = fileURLToPath(new URL('../bin/cossack.js', import.meta.url));

/**
 * CLI-03 regressions for selected command families — exactly
 * one parseable JSON envelope on stdout under `--json` (no banners, no
 * interleaved tool output), structured diagnostics with stable codes and
 * nonzero exits on failure, and no writes for dry runs.
 */

let tmp;
let liveChildren;

function runCli(argv, options = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [bin, ...argv], {
      cwd: options.cwd ?? tmp,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ?? process.env,
    });
    liveChildren.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => {
      liveChildren.delete(child);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on('error', error => { stderr += String(error); });
  });
}

/** Exactly one JSON envelope on stdout; anything else is a contract failure. */
function parseEnvelope(stdout) {
  const lines = stdout.split('\n').filter(line => line.trim());
  expect(lines, `expected one JSON line, got: ${stdout}`).toHaveLength(1);
  return JSON.parse(lines[0]);
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-subprocess-'));
  liveChildren = new Set();
  await fs.writeFile(path.join(tmp, 'package.json'), '{}');
});

describe('adapter, image, upgrade, and Studio machine contracts', () => {
  it.each(['build', 'ssg'])('%s isolates project logs and reports tool failure', async command => {
    const toolDir = path.join(tmp, 'tools');
    await fs.mkdir(toolDir);
    await fs.writeFile(path.join(toolDir, 'vite'), '#!/usr/bin/env node\n' +
      'console.log("project-private-value"); console.error("parser-private-value"); process.exit(1);\n', { mode: 0o755 });
    const result = await runCli([command, '--json', ...(command === 'ssg' ? ['--base-url', 'https://private-value.test'] : [])],
      { env: { ...process.env, PATH: `${toolDir}${path.delimiter}${process.env.PATH}` } });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('private-value');
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.diagnostics.some(item => item.code === (command === 'build' ? 'COSSACK_BUILD_FAILED' : 'COSSACK_SSG_BUILD_FAILED'))).toBe(true);
    expect(envelope.data).not.toHaveProperty('output');
  });

  async function project(preservePackage = false) {
    const result = await createApp('app', { cwd: tmp, adapter: 'node', preset: 'minimal', interactive: false });
    // Keep registry access out of file-planning fixtures.
    if (!preservePackage) await fs.writeFile(path.join(result.projectDir, 'package.json'), '{"name":"app","type":"module"}\n');
    return result.projectDir;
  }

  it('adapter plans and applies without prompts or secret output', async () => {
    const cwd = await project(true);
    await fs.writeFile(path.join(cwd, '.env'), 'APP_SECRET=adapter-private-value\n');
    const planned = await runCli(['adapter', 'cloudflare', '--dry-run', '--json'], { cwd });
    expect(planned.code).toBe(0);
    expect(planned.stderr).toBe('');
    expect(parseEnvelope(planned.stdout).data).toMatchObject({ status: 'dry-run', previousAdapter: 'node', targetAdapter: 'cloudflare' });
    expect(planned.stdout).not.toContain('adapter-private-value');
    const applied = await runCli(['adapter', 'cloudflare', '--json'], { cwd });
    expect(applied.code).toBe(0);
    expect(applied.stderr).toBe('');
    expect(parseEnvelope(applied.stdout).data.status).toBe('changed');
    expect(applied.stdout).not.toContain('adapter-private-value');
    const present = await runCli(['adapter', 'cloudflare', '--json'], { cwd });
    expect(parseEnvelope(present.stdout).data.status).toBe('present');
  });

  it('adapter reports unsupported database choices without printing a human error', async () => {
    const cwd = await project();
    const result = await runCli(['adapter', 'cloudflare', '--database', 'postgres', '--json'], { cwd });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(parseEnvelope(result.stdout).diagnostics[0].code).toBe('COSSACK_TARGET_INCOMPATIBLE');
  });

  it('image plans files without a converter and rejects unsafe sources and invalid quality', async () => {
    await fs.mkdir(path.join(tmp, 'src'));
    await fs.mkdir(path.join(tmp, 'public'));
    await fs.writeFile(path.join(tmp, 'public/photo.png'), 'image');
    await fs.writeFile(path.join(tmp, 'src/page.ts'), "Image({ src: '/photo.png', width: 200 });");
    const result = await runCli(['image', 'optimize', '--dry-run', '--json']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    const data = parseEnvelope(result.stdout).data;
    expect(data).toMatchObject({ status: 'dry-run', planned: 1, optimized: 0 });
    expect(data.effects[0].action).toBe('planned');
    expect(await fs.readdir(path.join(tmp, 'public'))).toEqual(['photo.png']);
    for (const quality of ['-1', '101', '2.5', 'oops']) {
      const invalid = await runCli(['image', 'optimize', `--quality=${quality}`, '--json']);
      expect(invalid.code).toBe(1);
      expect(parseEnvelope(invalid.stdout).diagnostics[0].code).toBe('COSSACK_IMAGE_QUALITY_INVALID');
    }
    await fs.writeFile(path.join(tmp, 'src/page.ts'), "Image({ src: '/../outside.png', width: 200 });");
    const unsafe = await runCli(['image', 'optimize', '--dry-run', '--json']);
    expect(unsafe.code).toBe(1);
    expect(parseEnvelope(unsafe.stdout).diagnostics[0].code).toBe('COSSACK_IMAGE_PATH_INVALID');
    await fs.writeFile(path.join(tmp, 'src/page.ts'), "Image({ src: '/photo.png', width: 200 });");
    await fs.symlink(path.join(tmp, 'outside-output.webp'), path.join(tmp, 'public/photo-200.webp'));
    const linked = await runCli(['image', 'optimize', '--dry-run', '--json']);
    expect(linked.code).toBe(1);
    expect(parseEnvelope(linked.stdout).diagnostics[0].code).toBe('COSSACK_IMAGE_PATH_INVALID');
  });

  it('image reports empty projects and invalid subcommands in one envelope', async () => {
    const empty = await runCli(['image', 'optimize', '--json']);
    expect(empty.code).toBe(0);
    expect(empty.stderr).toBe('');
    expect(parseEnvelope(empty.stdout).data.status).toBe('empty');
    const invalid = await runCli(['image', 'unknown', '--json']);
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toBe('');
    expect(parseEnvelope(invalid.stdout).diagnostics[0].code).toBe('COSSACK_ACTION_UNKNOWN');
  });

  it('upgrade exposes preserved conflicts and rejects an unowned force-file before writes', async () => {
    const cwd = await project();
    const appPath = path.join(cwd, 'src/App.ts');
    await fs.writeFile(appPath, '// custom application\n');
    const before = await fs.readFile(path.join(cwd, 'package.json'), 'utf8');
    const planned = await runCli(['upgrade', '--apply-template', '--dry-run', '--json'], { cwd });
    expect(planned.code).toBe(0);
    expect(planned.stderr).toBe('');
    const plan = parseEnvelope(planned.stdout).data.plan;
    expect(plan.files.preserved).toContain('src/App.ts');
    expect(plan.files.conflicts).toContainEqual({ path: 'src/App.ts', resolution: 'preserve' });
    expect(plan.dependencies).toMatchObject({ updates: [], additions: [], removals: [] });
    expect(await fs.readFile(path.join(cwd, 'package.json'), 'utf8')).toBe(before);
    const invalid = await runCli(['upgrade', '--force-file=../outside.ts', '--json'], { cwd });
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toBe('');
    expect(parseEnvelope(invalid.stdout).diagnostics[0].code).toBe('COSSACK_UPGRADE_FILE_UNKNOWN');
    expect(await fs.readFile(path.join(cwd, 'package.json'), 'utf8')).toBe(before);
    const applied = await runCli(['upgrade', '--apply-template', '--json'], { cwd });
    expect(applied.code).toBe(0);
    expect(parseEnvelope(applied.stdout).data.status).toBe('completed');
    expect(await fs.readFile(appPath, 'utf8')).toBe('// custom application\n');
  });

  it('upgrade reports installation failure with its applied dependency changes and recovery', async () => {
    const cwd = await project();
    await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'app', type: 'module',
      dependencies: { '@cossackframework/core': '^0.8.3' }, packageManager: 'pnpm@11.19.0' }));
    const toolDir = path.join(tmp, 'tools');
    await fs.mkdir(toolDir);
    await fs.writeFile(path.join(toolDir, 'pnpm'), '#!/usr/bin/env node\n' +
      'if (process.argv[2] === "view") console.log(JSON.stringify("0.9.0"));\n' +
      'else { console.error("installer-private-value"); process.exit(1); }\n', { mode: 0o755 });
    const result = await runCli(['upgrade', '--json'], { cwd,
      env: { ...process.env, PATH: `${toolDir}${path.delimiter}${process.env.PATH}` } });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('installer-private-value');
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.diagnostics[0].code).toBe('COSSACK_UPGRADE_INSTALL_FAILED');
    expect(envelope.data).toMatchObject({ status: 'partial-failure', applied: { dependencies: true, installed: false } });
    expect(envelope.data.nextActions).toContain('pnpm install');
    expect(JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8')).dependencies['@cossackframework/core']).toBe('^0.9.0');
  });

  it('upgrade rejects a stale plan if files change during registry resolution', async () => {
    const cwd = await project();
    const relative = 'src/App.ts';
    const file = path.join(cwd, relative);
    // Make the file unchanged against its old baseline, with a template update available.
    await fs.writeFile(file, '// previous template\n');
    const { createHash } = await import('node:crypto');
    const manifestFile = path.join(cwd, '.cossack/scaffold.json');
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    manifest.files[relative].hash = createHash('sha256').update('// previous template\n').digest('hex');
    await fs.writeFile(manifestFile, JSON.stringify(manifest));
    const packageSource = JSON.stringify({ name: 'app', type: 'module',
      dependencies: { '@cossackframework/core': '^0.8.3' } });
    await fs.writeFile(path.join(cwd, 'package.json'), packageSource);
    const toolDir = path.join(tmp, 'tools');
    await fs.mkdir(toolDir);
    await fs.writeFile(path.join(toolDir, 'pnpm'), '#!/usr/bin/env node\n' +
      'require("node:fs").writeFileSync(process.env.FIXTURE_EDIT_PATH, "// edit during planning\\n");\n' +
      'console.log(JSON.stringify("0.9.0"));\n', { mode: 0o755 });
    const result = await runCli(['upgrade', '--apply-template', '--json'], { cwd,
      env: { ...process.env, FIXTURE_EDIT_PATH: file, PATH: `${toolDir}${path.delimiter}${process.env.PATH}` } });
    expect(result.code).toBe(1);
    expect(parseEnvelope(result.stdout).diagnostics[0].code).toBe('COSSACK_UPGRADE_PLAN_STALE');
    expect(await fs.readFile(file, 'utf8')).toBe('// edit during planning\n');
    expect(await fs.readFile(path.join(cwd, 'package.json'), 'utf8')).toBe(packageSource);
  });

  async function studioFixture(body) {
    const packageRoot = path.join(tmp, 'node_modules/@cossackframework/studio');
    await fs.mkdir(path.join(packageRoot, 'dist'), { recursive: true });
    await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ type: 'module',
      exports: { './package.json': './package.json' } }));
    await fs.writeFile(path.join(packageRoot, 'dist/index.js'), body);
    await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({ type: 'module',
      devDependencies: { '@cossackframework/studio': '^0.9.0' } }));
  }

  it('Studio emits ready/stopped NDJSON events while isolating application logs and launch tokens', async () => {
    await studioFixture(`console.log('module-private-value');
      export async function runStudio(options) {
        console.error('launch-token-private-value');
        options.onReady({ origin: 'http://localhost:4983', remote: false, token: 'launch-token-private-value' });
      }`);
    const result = await runCli(['studio', '--json']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('private-value');
    const events = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(events.map(event => event.data.event)).toEqual(['ready', 'stopped']);
    expect(events.every(event => event.schemaVersion === 1 && event.ok)).toBe(true);
    expect(events[0].data.origin).toBe('http://localhost:4983');
  });

  it('Studio has bounded startup and structured failures without importing source in dry runs', async () => {
    await studioFixture(`throw new Error('module-private-value');`);
    const planned = await runCli(['studio', '--dry-run', '--json']);
    expect(planned.code).toBe(0);
    expect(parseEnvelope(planned.stdout).data.event).toBe('planned');
    const failed = await runCli(['studio', '--json']);
    expect(failed.code).toBe(1);
    expect(failed.stdout).not.toContain('module-private-value');
    expect(parseEnvelope(failed.stdout).diagnostics[0].code).toBe('COSSACK_STUDIO_EXECUTION_FAILED');
    await studioFixture(`export async function runStudio() { setInterval(() => {}, 10000); await new Promise(() => {}); }`);
    const timeout = await runCli(['studio', '--json', '--timeout=100']);
    expect(timeout.code).toBe(1);
    expect(timeout.stderr).toBe('');
    expect(parseEnvelope(timeout.stdout).diagnostics[0].code).toBe('COSSACK_STUDIO_STARTUP_TIMEOUT');
  });
});
afterEach(async () => {
  const running = liveChildren.size;
  for (const child of liveChildren) child.kill();
  await fs.rm(tmp, { recursive: true, force: true });
  expect(running, 'no subprocess should remain running').toBe(0);
});

describe('version and info', () => {
  it('version --json emits exactly one envelope', async () => {
    const { code, stdout, stderr } = await runCli(['version', '--json']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const result = parseEnvelope(stdout);
    expect(result).toMatchObject({ schemaVersion: 1, command: 'version', ok: true });
    expect(result.data.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('version rejects unknown options and extra positionals', async () => {
    const invalid = await runCli(['version', '--bogus=1', '--json']);
    expect(invalid.code).toBe(1);
    expect(parseEnvelope(invalid.stdout)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'COSSACK_OPTION_UNKNOWN' }],
    });
    const extra = await runCli(['version', 'extra', '--json']);
    expect(extra.code).toBe(1);
    expect(parseEnvelope(extra.stdout).diagnostics[0].code).toBe('COSSACK_ARGUMENT_UNEXPECTED');
  });

  it('info --json emits the environment summary without stderr noise', async () => {
    const { code, stdout, stderr } = await runCli(['info', '--json']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const result = parseEnvelope(stdout);
    expect(result.command).toBe('info');
    expect(result.data).toHaveProperty('cliVersion');
    expect(result.data).toHaveProperty('packages');
  });
});

describe('routes and inspection', () => {
  it('unknown routes emit exactly one coded failure envelope', async () => {
    const result = await runCli(['inspect', 'routes', '/missing', '--json']);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(parseEnvelope(result.stdout).diagnostics[0].code).toBe('COSSACK_ROUTE_UNKNOWN');
  });

  it('rejects a second route positional before inspection', async () => {
    const result = await runCli(['inspect', 'routes', '/a', '/b', '--json']);
    expect(result.code).toBe(1);
    expect(parseEnvelope(result.stdout).diagnostics[0].code).toBe('COSSACK_ARGUMENT_UNEXPECTED');
  });
  it('routes --json lists the fixture route with its layout', async () => {
    await fs.mkdir(path.join(tmp, 'src/pages/dashboard/users/[id]'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'src/pages/layout.ts'), 'export default 1;');
    await fs.writeFile(path.join(tmp, 'src/pages/dashboard/layout.ts'), "@Page({ services: [Users] })\nexport default class Layout {}");
    await fs.writeFile(path.join(tmp, 'src/pages/dashboard/users/[id]/index.ts'), "@Page({ transport: 'sse' })\nexport default class Users {}");
    const { code, stdout, stderr } = await runCli(['routes', '--json']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const result = parseEnvelope(stdout);
    const users = result.data.routes.find(route => route.params?.length);
    expect(users).toMatchObject({ route: '/dashboard/users/:id', transport: 'sse' });
    expect(users.layouts).toContain('/src/pages/dashboard/layout.ts');
    // Service ownership is an inspection fact: ask the explain surface.
    const explained = await runCli(['inspect', 'routes', '/dashboard/users/:id', '--json']);
    const explanation = parseEnvelope(explained.stdout);
    expect(explanation.data.reasons.join('\n')).toContain('Users (/src/pages/dashboard/layout.ts)');
  });

  it('inspect routes <route> explains behavior with reasons', async () => {
    await fs.mkdir(path.join(tmp, 'src/pages/team'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'src/pages/team/index.ts'), "@Page({ transport: 'http', middlewares: [async (c, next) => { await next(); }] })\nexport default class Team {}");
    const { code, stdout } = await runCli(['inspect', 'routes', '/team', '--json']);
    expect(code).toBe(0);
    const result = parseEnvelope(stdout);
    expect(result.data.reasons.join('\n')).toContain('Transport "http"');
    expect(result.data.reasons.join('\n')).toContain('1 middleware(s)');
  });

  it('inspect routes rejects unknown flags through the shared spec', async () => {
    const invalid = await runCli(['inspect', 'routes', '--bogus=1', '--json']);
    expect(invalid.code).toBe(1);
    expect(parseEnvelope(invalid.stdout).diagnostics[0].code).toBe('COSSACK_OPTION_UNKNOWN');
  });
});

describe('generate', () => {
  it('delete plans effects without removing files and reports missing files with a code', async () => {
    await runCli(['generate', 'component', 'KeepMe']);
    const planned = await runCli(['delete', 'component', 'KeepMe', '--dry-run', '--json']);
    expect(planned.code).toBe(0);
    expect(planned.stderr).toBe('');
    expect(parseEnvelope(planned.stdout).data.effects).toEqual([
      { action: 'planned-delete', path: 'src/components/KeepMe.ts' },
    ]);
    expect(await fs.readFile(path.join(tmp, 'src/components/KeepMe.ts'), 'utf8')).toContain('KeepMe');
    const missing = await runCli(['delete', 'component', 'Missing', '--json']);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toBe('');
    expect(parseEnvelope(missing.stdout).diagnostics[0].code).toBe('COSSACK_FILE_NOT_FOUND');
  });
  it('dry run plans the file without writing and emits one envelope', async () => {
    const { code, stdout, stderr } = await runCli(['generate', 'component', 'ReviewProbe', '--dry-run', '--json']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const result = parseEnvelope(stdout);
    expect(result.ok).toBe(true);
    expect(result.data.effects).toEqual([
      { action: 'planned', path: 'src/components/ReviewProbe.ts' },
    ]);
    await expect(fs.access(path.join(tmp, 'src/components/ReviewProbe.ts'))).rejects.toThrow();
  });

  it('a real run writes exactly the planned file', async () => {
    const { code, stdout } = await runCli(['g', 'c', 'CartBadge', '--json']);
    expect(code).toBe(0);
    const result = parseEnvelope(stdout);
    expect(result.data.effects).toEqual([{ action: 'created', path: 'src/components/CartBadge.ts' }]);
    const written = await fs.readFile(path.join(tmp, 'src/components/CartBadge.ts'), 'utf8');
    expect(written.length).toBeGreaterThan(0);
  });

  it('a second run without --force fails with a coded diagnostic and writes nothing new', async () => {
    await runCli(['g', 'c', 'CartBadge']);
    const duplicate = await runCli(['g', 'c', 'CartBadge', '--json']);
    expect(duplicate.code).toBe(1);
    const result = parseEnvelope(duplicate.stdout);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'COSSACK_FILE_EXISTS',
      message: expect.stringContaining('CartBadge.ts'),
    });
    // The failure path prints nothing human to stdout under --json.
    expect(duplicate.stdout.split('\n').filter(l => l.trim())).toHaveLength(1);
  });

  it('unknown types and missing names fail with codes before effects', async () => {
    const unknown = await runCli(['g', 'widget', 'x', '--json']);
    expect(unknown.code).toBe(1);
    expect(parseEnvelope(unknown.stdout).diagnostics[0].code).toBe('COSSACK_GENERATE_TYPE_UNKNOWN');
    const missing = await runCli(['g', 'component', '--json']);
    expect(missing.code).toBe(1);
    expect(parseEnvelope(missing.stdout).diagnostics[0].code).toBe('COSSACK_ARGUMENT_MISSING');
  });

  it('flag values resembling flags are parse errors, not silent booleans', async () => {
    const ambiguous = await runCli(['g', 'page', 'X', '--title', '--force', '--json']);
    expect(ambiguous.code).toBe(1);
    const result = parseEnvelope(ambiguous.stdout);
    expect(result.diagnostics[0].code).toBe('COSSACK_OPTION_VALUE_REQUIRED');
  });
});

describe('add / remove / lang', () => {
  it('add --dry-run --json plans feature effects without writes', async () => {
    // A minimal project without the feature present.
    const { code, stdout, stderr } = await runCli(['add', 'ui', '--dry-run', '--yes', '--runtime', 'cloudflare', '--json']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const result = parseEnvelope(stdout);
    expect(result.command).toBe('add');
    expect(Array.isArray(result.data.effects)).toBe(true);
    expect(result.data.effects.every(effect => effect.action === 'planned' || effect.action === 'skipped')).toBe(true);
  });

  it('add failures in a bare project are coded diagnostics, not human prints', async () => {
    const failure = await runCli(['add', 'ui', '--dry-run', '--yes', '--json']);
    expect(failure.code).toBe(1);
    const result = parseEnvelope(failure.stdout);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe('COSSACK_FEATURE_ADD_FAILED');
    expect(result.diagnostics[0].message).toContain('runtime');
  });

  it('lang publish --dry-run --json plans the catalog', async () => {
    const { code, stdout, stderr } = await runCli(['lang', 'publish', '--dry-run', '--json']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const result = parseEnvelope(stdout);
    expect(result.command).toBe('lang');
    expect(result.data.locale).toBe('en');
    expect(result.data.effects.some(effect => effect.path.includes('src/lang/en.json'))).toBe(true);
    await expect(fs.access(path.join(tmp, 'src/lang/en.json'))).rejects.toThrow();
  });

  it('lang add rejects a missing locale with a code', async () => {
    const missing = await runCli(['lang', 'add', '--json']);
    expect(missing.code).toBe(1);
    expect(parseEnvelope(missing.stdout).diagnostics[0].code).toBe('COSSACK_ARGUMENT_MISSING');
  });
});

describe('lifecycle commands', () => {
  it('build --json fails outside a project with one envelope', async () => {
    const { code, stdout } = await runCli(['build', '--json']);
    // vite is absent in the bare fixture: the failure must still be one
    // envelope with a nonzero exit (or a successful envelope with exitCode).
    const result = parseEnvelope(stdout);
    expect(result.command).toBe('build');
    if (result.ok) expect(result.data.exitCode).not.toBe(0);
    expect(code).not.toBe(0);
  }, 30_000);

  it('dev/start --json report unavailable tools or build artifacts without logs', async () => {
    for (const [command, code] of [['dev', 'COSSACK_DEV_FAILED'], ['start', 'COSSACK_SERVER_ENTRY_MISSING']]) {
      const result = await runCli([command, '--json'], { env: { ...process.env, PATH: '/nonexistent' } });
      expect(result.code, command).toBe(1);
      const envelope = parseEnvelope(result.stdout);
      expect(envelope.diagnostics[0].code).toBe(code);
    }
  });
});
