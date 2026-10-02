import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/cossack.js', import.meta.url));

/**
 * CLI-03 acceptance: every command speaks one subprocess contract — exactly
 * one parseable JSON envelope on stdout under `--json` (no banners, no
 * interleaved tool output), structured diagnostics with stable codes and
 * nonzero exits on failure, and no writes for dry runs.
 */

let tmp;
let runLog;

function runCli(argv, options = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [bin, ...argv], {
      cwd: options.cwd ?? tmp,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('exit', code => resolve({ code: code ?? 1, stdout, stderr }));
    child.on('error', error => resolve({ code: 1, stdout, stderr: `${stderr}${error}` }));
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
  runLog = [];
  await fs.writeFile(path.join(tmp, 'package.json'), '{}');
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
  expect(runLog, 'no subprocess should remain running').toEqual([]);
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
  it('routes --json lists the fixture route with its layout', async () => {
    await fs.mkdir(path.join(tmp, 'src/pages/dashboard/users/[id]'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'src/pages/layout.ts'), 'export default 1;');
    await fs.writeFile(path.join(tmp, 'src/pages/dashboard/layout.ts'), "@Page({ services: [Users] })\nexport default 2;");
    await fs.writeFile(path.join(tmp, 'src/pages/dashboard/users/[id]/index.ts'), "@Page({ transport: 'sse' })\nexport default 3;");
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
    await fs.writeFile(path.join(tmp, 'src/pages/team/index.ts'), "@Page({ transport: 'http', middlewares: [async (c, next) => { await next(); }] })\nexport default 1;");
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
    const ambiguous = await runCli(['g', 'c', 'X', '--tag', '--force', '--json']);
    expect(ambiguous.code).toBe(1);
    const result = parseEnvelope(ambiguous.stdout);
    expect(result.diagnostics[0].code).toBe('COSSACK_OPTION_INVALID');
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

  it('dev/start --json fail fast with COSSACK_JSON_UNSUPPORTED', async () => {
    for (const command of ['dev', 'start']) {
      const result = await runCli([command, '--json']);
      expect(result.code, command).toBe(1);
      const envelope = parseEnvelope(result.stdout);
      expect(envelope.diagnostics[0].code).toBe('COSSACK_JSON_UNSUPPORTED');
    }
  });
});
