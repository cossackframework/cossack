import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  createHostedPreviewCommandRecorder,
  downloadHostedPreviewJournals,
  makePortableTarballApp,
  runHostedPreviewCI,
  verifyHostedPreviewCI,
} from './fixtures/cloudflare-preview-hosted-ci.js';

const { parse } = createRequire(import.meta.resolve('@cossackframework/scaffold/package.json'))('yaml');

describe('portable hosted app dependencies', () => {
  it('preserves generated build approvals and app-owned workspace settings while replacing only retained Cossack overrides', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-portable-workspace-'));
    try {
      const app = path.join(root, 'app');
      const installed = path.join(root, 'installed');
      await fs.mkdir(app);
      await fs.mkdir(installed);
      const targets = {};
      for (const [name, basename] of [
        ['cossack', 'cossack.tgz'],
        ['@cossackframework/framework', 'framework.tgz'],
      ]) {
        const filename = path.join(installed, basename);
        await fs.writeFile(filename, `retained-${name}`);
        targets[name] = `file:${filename}`;
      }
      await fs.writeFile(path.join(installed, 'package.json'), JSON.stringify({ dependencies: targets }));
      await fs.writeFile(
        path.join(app, 'package.json'),
        JSON.stringify({
          dependencies: { '@cossackframework/framework': '^0.8.3', unrelated: '^1.0.0' },
          devDependencies: { cossack: '^0.8.3' },
        }),
      );
      const original =
        '# Approved by the generated scaffold\npackages:\n  - .\n  - tools/*\nallowBuilds:\n  esbuild: true\n  workerd: true\n  untrusted-build: false\nstrictDepBuilds: true\nminimumReleaseAge: 60\noverrides:\n  unrelated: 1.2.3\n  cossack: old-target\n';
      await fs.writeFile(path.join(app, 'pnpm-workspace.yaml'), original);
      const overrides = await makePortableTarballApp(app, installed);
      const result = await fs.readFile(path.join(app, 'pnpm-workspace.yaml'), 'utf8');
      expect(parse(result)).toEqual({ ...parse(original), overrides: { unrelated: '1.2.3', ...overrides } });
      expect(result).toContain('# Approved by the generated scaffold');
      expect(parse(result)).not.toHaveProperty('allowAllBuilds');
      const pkg = JSON.parse(await fs.readFile(path.join(app, 'package.json'), 'utf8'));
      expect(pkg.dependencies).toEqual({
        '@cossackframework/framework': overrides['@cossackframework/framework'],
        unrelated: '^1.0.0',
      });
      expect(pkg.devDependencies.cossack).toBe(overrides.cossack);
      for (const [name, relative] of Object.entries(overrides))
        expect(await fs.readFile(path.join(app, relative.slice(5)), 'utf8')).toBe(`retained-${name}`);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

function evidence() {
  const owned = (id, status) => ({
    schemaVersion: 1,
    status,
    accountId: 'a'.repeat(32),
    worker: 'owned-parent',
    name: `preview-${id}`,
    tag: `cossack:${id.repeat(32)}`,
    preview: { id, createdOn: '2026-10-09T00:00:00Z' },
    deployment: { id: `deploy-${id}` },
    resources: [{ kind: 'd1_databases', ownership: 'existing-staging', cleanup: 'retain' }],
  });
  const run = (conclusion) => ({ event: 'workflow_dispatch', status: 'completed', conclusion });
  const success = {
    run: run('success'),
    intent: owned('a', 'deployed'),
    final: owned('a', 'cleaned'),
    remoteAbsent: true,
  };
  const failure = {
    run: run('failure'),
    intent: owned('b', 'smoke-failed'),
    final: owned('b', 'cleaned'),
    remoteAbsent: true,
  };
  const production = { settings: { bindings: ['production-db'] }, deployments: { versions: ['original-version'] } };
  return {
    success,
    failure,
    retry: { run: run('success'), final: owned('b', 'cleaned') },
    before: {
      production,
      productionD1: { scope: 'production', visits: 0 },
      stagingD1: { scope: 'staging', visits: 0 },
    },
    after: {
      production: structuredClone(production),
      productionD1: { scope: 'production', visits: 0 },
      stagingD1: { scope: 'staging', visits: 2 },
    },
    resources: { accountId: 'a'.repeat(32), worker: 'owned-parent', productionD1: 'prod-id', stagingD1: 'stage-id' },
    workflowUnchanged: true,
    installedTarballs: true,
  };
}

describe('hosted preview CI evidence boundary', () => {
  it('accepts the complete success, failed smoke, retry, isolation and unchanged production evidence', () => {
    expect(verifyHostedPreviewCI(evidence())).toEqual({ passed: true, missing: [] });
  });
  it('reports incomplete absent evidence without throwing', () => {
    for (const value of [undefined, {}, { before: {} }, { after: {} }])
      expect(verifyHostedPreviewCI(value).passed).toBe(false);
  });
  it.each([
    ['empty IDs', (e) => (e.success.intent.preview.id = '')],
    ['missing creation time', (e) => delete e.success.intent.preview.createdOn],
    ['missing before', (e) => delete e.before],
    ['missing after', (e) => delete e.after],
    ['a local run', (e) => (e.success.run.event = 'local')],
    ['a failed create claimed successful', (e) => (e.success.run.conclusion = 'failure')],
    ['failed smoke without retained intent', (e) => delete e.failure.intent],
    ['name-only cleanup', (e) => delete e.failure.final.preview.id],
    ['replaced deployment', (e) => (e.success.final.deployment.id = 'foreign')],
    ['missing provider absence', (e) => (e.success.remoteAbsent = false)],
    ['retry with unrelated journal', (e) => (e.retry.final.preview.id = 'foreign')],
    ['reused preview identity', (e) => (e.failure.intent.preview.id = e.success.intent.preview.id)],
    ['production deployment mutation', (e) => (e.after.production.deployments.versions = ['changed'])],
    ['production data mutation', (e) => (e.after.productionD1.visits = 1)],
    ['no real staging effects', (e) => (e.after.stagingD1.visits = 0)],
    ['shared D1', (e) => (e.resources.stagingD1 = e.resources.productionD1)],
    ['wrong parent', (e) => (e.resources.worker = 'foreign')],
    ['changed workflow', (e) => (e.workflowUnchanged = false)],
    ['workspace links', (e) => (e.installedTarballs = false)],
  ])('rejects %s', (_label, mutate) => {
    const value = evidence();
    mutate(value);
    expect(verifyHostedPreviewCI(value).passed).toBe(false);
  });
});

it.skipIf(!process.env.COSSACK_PREVIEW_HOSTED_CI_OPTIONS)(
  'executes the reviewed workflow on actual hosted GitHub and verifies provider isolation',
  async () => {
    const options = JSON.parse(await fs.readFile(process.env.COSSACK_PREVIEW_HOSTED_CI_OPTIONS, 'utf8'));
    expect((await runHostedPreviewCI(options)).passed).toBe(true);
  },
  95 * 60_000,
);

async function withEvidenceDirectory(fn) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-preview-diagnostics-'));
  try {
    await fn(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

describe('private hosted preview command diagnostics', () => {
  it('writes an existing bounded private receipt on failure with known secrets redacted and a fixed error', async () => {
    await withEvidenceDirectory(async (directory) => {
      await fs.chmod(directory, 0o755);
      const env = {
        CLOUDFLARE_API_TOKEN: 'CF-private-value',
        GH_TOKEN: 'GH-private-value',
        GITHUB_TOKEN: 'GITHUB-private-value',
        COSSACK_PREVIEW_SECRETS_JSON: JSON.stringify({ APP_SECRET: 'private\"line\nvalue' }),
      };
      const values = [...Object.values(env), JSON.parse(env.COSSACK_PREVIEW_SECRETS_JSON).APP_SECRET];
      let attempts = 0;
      const commands = await createHostedPreviewCommandRecorder(directory, {
        env,
        runner: async () => {
          attempts++;
          throw Object.assign(new Error('Raw exception contains CF-private-value'), {
            code: 1,
            signal: 'SIGTERM',
            stdout: values.join('|') + 'x'.repeat(100_000) + ' native terminal failure',
            stderr:
              'HTTP 403 Forbidden: authoritative provider message ' +
              JSON.stringify({ secret: values.at(-1) }) +
              values.join('|') +
              'y'.repeat(100_000),
          });
        },
      });
      let failure;
      try {
        await commands.json([
          'api',
          '--method',
          'POST',
          'repos/owner/acceptance/actions/workflows/preview.yml/dispatches',
        ]);
      } catch (error) {
        failure = error;
      }
      expect(failure.message).toBe('GitHub operation failed; private receipt gh-1.json');
      expect(failure.cause).toBeUndefined();
      expect(attempts).toBe(1); // An uncertain POST is never retried for diagnosis.
      const file = path.join(directory, 'gh-1.json');
      const text = await fs.readFile(file, 'utf8'),
        receipt = JSON.parse(text);
      expect(receipt.exitCode).toBe(1);
      expect(receipt.signal).toBe('SIGTERM');
      expect(receipt.stderr).toContain('HTTP 403 Forbidden: authoritative provider message');
      expect(receipt.stdoutTruncated).toBe(true);
      expect(receipt.stdout).toContain('native terminal failure');
      expect(receipt.stderrTruncated).toBe(true);
      expect(Buffer.byteLength(receipt.stdout)).toBeLessThanOrEqual(64 * 1024);
      expect(Buffer.byteLength(receipt.stderr)).toBeLessThanOrEqual(64 * 1024);
      expect(Buffer.byteLength(text)).toBeLessThan(800 * 1024);
      for (const secret of values) {
        expect(text).not.toContain(secret);
        expect(text).not.toContain(JSON.stringify(secret).slice(1, -1));
      }
      expect(text).not.toContain('Raw exception');
      expect(text).not.toContain('dispatches');
      if (process.platform !== 'win32') {
        expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
        expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
      }
    });
  });

  it('keeps successful stdout parseable while redacting its stored receipt and fixes malformed reply errors', async () => {
    await withEvidenceDirectory(async (directory) => {
      let call = 0;
      const commands = await createHostedPreviewCommandRecorder(directory, {
        env: { GH_TOKEN: 'private-gh-token' },
        runner: async () => ({
          stdout: ++call === 1 ? '{"value":"private-gh-token"}' : 'invalid private-gh-token',
          stderr: '',
        }),
      });
      expect(await commands.json(['api', 'repos/owner/acceptance'])).toEqual({ value: 'private-gh-token' });
      expect(await fs.readFile(path.join(directory, 'gh-1.json'), 'utf8')).not.toContain('private-gh-token');
      await expect(commands.json(['api', 'repos/owner/acceptance'])).rejects.toThrow(
        'GitHub response invalid; private receipt gh-2.json',
      );
      expect(JSON.parse(await fs.readFile(path.join(directory, 'gh-2.json'), 'utf8')).stdout).toBe(
        'invalid [REDACTED]',
      );
    });
  });

  it('captures completed run metadata, jobs, check annotations and logs before a missing journal failure', async () => {
    await withEvidenceDirectory(async (directory) => {
      const calls = [];
      const commands = await createHostedPreviewCommandRecorder(directory, {
        env: { CLOUDFLARE_API_TOKEN: 'cloud-private' },
        runner: async (_binary, args) => {
          calls.push(args);
          if (args[0] === 'api' && args[1].includes('/jobs?'))
            return {
              stdout: JSON.stringify({
                total_count: 1,
                jobs: [
                  {
                    id: 40,
                    check_run_url: 'https://api.github.com/repos/owner/acceptance/check-runs/50',
                    conclusion: 'failure',
                  },
                ],
              }),
              stderr: '',
            };
          if (args[0] === 'api' && args[1].includes('/annotations?'))
            return {
              stdout: JSON.stringify([{ message: 'Native build failed', raw_details: 'cloud-private' }]),
              stderr: '',
            };
          if (args[0] === 'run' && args[1] === 'view')
            return { stdout: 'Native build failure before upload cloud-private', stderr: '' };
          if (args[0] === 'run' && args[1] === 'download')
            throw Object.assign(new Error('private command cause'), {
              code: 1,
              stdout: '',
              stderr: 'no valid artifacts found',
            });
          throw new Error('Unexpected diagnostic command');
        },
      });
      const run = {
        id: 123,
        status: 'completed',
        event: 'workflow_dispatch',
        conclusion: 'failure',
        head_sha: 'owned-code',
      };
      await expect(downloadHostedPreviewJournals(commands, 'owner/acceptance', run, directory)).rejects.toThrow(
        'GitHub operation failed; private receipt gh-4.json',
      );
      expect(
        calls.map((args) => (args[0] === 'api' ? (args[1].includes('/jobs?') ? 'jobs' : 'annotations') : args[1])),
      ).toEqual(['jobs', 'annotations', 'view', 'download']);
      expect(JSON.parse(await fs.readFile(path.join(directory, 'run-123-metadata.json'), 'utf8'))).toEqual(run);
      const diagnostics = JSON.parse(await fs.readFile(path.join(directory, 'run-123-diagnostics.json'), 'utf8'));
      expect(diagnostics).toMatchObject({ runId: 123, jobIds: [40], logReceipt: 'gh-3.json', failures: [] });
      for (const file of [
        'gh-1.json',
        'gh-2.json',
        'gh-3.json',
        'gh-4.json',
        'run-123-metadata.json',
        'run-123-diagnostics.json',
      ]) {
        expect(await fs.readFile(path.join(directory, file), 'utf8')).not.toContain('cloud-private');
        if (process.platform !== 'win32') expect((await fs.stat(path.join(directory, file))).mode & 0o777).toBe(0o600);
      }
      expect(JSON.parse(await fs.readFile(path.join(directory, 'gh-4.json'), 'utf8')).stderr).toContain(
        'no valid artifacts found',
      );
      await expect(fs.access(path.join(directory, 'evidence.json'))).rejects.toThrow();
      expect(verifyHostedPreviewCI({ success: { run } }).passed).toBe(false);
    });
  });

  it('keeps Unicode diagnostic truncation byte bounded and private JSON parseable', async () => {
    await withEvidenceDirectory(async (directory) => {
      const commands = await createHostedPreviewCommandRecorder(directory, {
        env: { GH_TOKEN: 'true' },
        runner: async () => ({ stdout: '🌍'.repeat(100_000) + ' terminal detail', stderr: '\u0000'.repeat(100_000) }),
      });
      await commands.raw(['run', 'view', '123', '--log']);
      const receipt = JSON.parse(await fs.readFile(path.join(directory, 'gh-1.json'), 'utf8'));
      expect(Buffer.byteLength(receipt.stdout)).toBeLessThanOrEqual(64 * 1024);
      expect(receipt.stdout).not.toContain('�');
      expect(receipt.stdout).toContain('terminal detail');
      expect((await fs.stat(path.join(directory, 'gh-1.json'))).size).toBeLessThanOrEqual(800 * 1024);
      await commands.privateJSON('metadata.json', { active: true, large: '🌍'.repeat(100_000) });
      const bounded = JSON.parse(await fs.readFile(path.join(directory, 'metadata.json'), 'utf8'));
      expect(bounded.truncated).toBe(true);
      await commands.privateJSON('small.json', { active: true });
      expect(JSON.parse(await fs.readFile(path.join(directory, 'small.json'), 'utf8'))).toMatchObject({
        redacted: true,
      });
    });
  });

  it('retains read-only diagnostic failures without hiding the primary artifact failure', async () => {
    await withEvidenceDirectory(async (directory) => {
      const calls = [];
      const commands = await createHostedPreviewCommandRecorder(directory, {
        env: {},
        runner: async (_binary, args) => {
          calls.push(args);
          throw Object.assign(new Error('raw provider error'), {
            code: 1,
            stdout: '',
            stderr: args.includes('download') ? 'no valid artifacts found' : 'HTTP 403 diagnostic unavailable',
          });
        },
      });
      await expect(
        downloadHostedPreviewJournals(commands, 'owner/acceptance', { id: 321, status: 'completed' }, directory),
      ).rejects.toThrow('GitHub operation failed; private receipt gh-3.json');
      expect(calls).toHaveLength(3);
      expect(calls.slice(0, 2).every((args) => !args.includes('POST'))).toBe(true);
      const diagnostics = JSON.parse(await fs.readFile(path.join(directory, 'run-321-diagnostics.json'), 'utf8'));
      expect(diagnostics.failures).toEqual([
        'GitHub operation failed; private receipt gh-1.json',
        'GitHub operation failed; private receipt gh-2.json',
      ]);
      expect(JSON.parse(await fs.readFile(path.join(directory, 'gh-3.json'), 'utf8')).stderr).toBe(
        'no valid artifacts found',
      );
    });
  });
});
