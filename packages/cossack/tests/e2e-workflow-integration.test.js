import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const workflow = parse(readFileSync(path.join(root, '.github/workflows/e2e-tests.yml'), 'utf8'));
const job = workflow.jobs['e2e-tests'];
const detection = job.steps.find(step => step.id === 'changes').run;

function detectChange(filename, missingBase = false, eventName = 'pull_request') {
  const cwd = mkdtempSync(path.join(tmpdir(), 'cossack-ci-changes-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init');
    git('config', 'user.name', 'CI test');
    git('config', 'user.email', 'ci-test@example.invalid');
    git('commit', '--allow-empty', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    mkdirSync(path.dirname(path.join(cwd, filename)), { recursive: true });
    writeFileSync(path.join(cwd, filename), 'change\n');
    git('add', filename);
    git('commit', '-m', 'head');
    const output = path.join(cwd, 'outputs');
    execFileSync('bash', ['-e', '-o', 'pipefail', '-c', detection], {
      cwd, env: { ...process.env, EVENT_NAME: eventName, BASE_SHA: missingBase ? '' : base, HEAD_SHA: git('rev-parse', 'HEAD'), GITHUB_OUTPUT: output },
      stdio: 'pipe',
    });
    return Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => line.split('=')));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

it.each(['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', '.github/workflows/e2e-tests.yml'])(
  'runs optional acceptance for shared changes in %s', filename => {
    expect(detectChange(filename)).toEqual({ desktop: 'true', generated_app: 'true', studio: 'true' });
  },
);

it.each(['packages/renderer/src/css.ts', 'packages/database/src/index.ts', 'packages/framework/src/client.ts'])(
  'runs Studio when an upstream dependency changes: %s', filename => {
    expect(detectChange(filename)).toEqual({ desktop: 'false', generated_app: 'true', studio: 'true' });
  },
);

it('skips optional suites for unrelated docs and runs them when the base is unavailable', () => {
  expect(detectChange('README.md')).toEqual({ desktop: 'false', generated_app: 'false', studio: 'false' });
  expect(detectChange('README.md', false, 'push')).toEqual({ desktop: 'false', generated_app: 'false', studio: 'false' });
  expect(detectChange('README.md', true)).toEqual({ desktop: 'true', generated_app: 'true', studio: 'true' });
});

it.each(['release', 'workflow_dispatch'])('runs every optional suite when called for %s', eventName => {
  // publish.yml calls this workflow; the caller's event reaches the step.
  expect(workflow.on).toHaveProperty('workflow_call');
  expect(detectChange('README.md', false, eventName)).toEqual({ desktop: 'true', generated_app: 'true', studio: 'true' });
});

it('pins the runner, installs only Chromium and uploads existing reports after test failures', () => {
  expect(job['runs-on']).toBe('ubuntu-24.04');
  expect(workflow.on).toHaveProperty('workflow_dispatch');
  const browserInstall = job.steps.find(step => step.run?.includes('playwright install'));
  expect(browserInstall.run).toContain('playwright install chromium --with-deps');
  const upload = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  expect(upload.if).toContain('!cancelled()');
  expect(upload.if).toContain('hashFiles(');
  expect(upload.if).not.toContain('success()');
  expect(upload.with.path).toContain('packages/studio/test-results/');
});
