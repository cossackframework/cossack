import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { expect, it } from 'vitest';

const filename = fileURLToPath(new URL('../template/.github/workflows/preview.yml', import.meta.url));
async function workflow() {
  const text = await fs.readFile(filename, 'utf8');
  const document = parseDocument(text, { uniqueKeys: true });
  expect(document.errors).toEqual([]);
  return { text, value: document.toJS() };
}
it('uses trusted manual invocation, bounded tooling and no install-time deployment credentials', async () => {
  const { value } = await workflow();
  expect(Object.keys(value.on)).toEqual(['workflow_dispatch']);
  expect(value.permissions).toEqual({ contents: 'read' });
  expect(value.concurrency['cancel-in-progress']).toBe(false);
  const job = value.jobs.preview;
  expect(job['timeout-minutes']).toBe(30);
  expect(job.permissions).toEqual({ contents: 'read', actions: 'read' });
  expect(job.env.CLOUDFLARE_API_TOKEN).toBeUndefined();
  const steps = job.steps;
  expect(steps.find(step => step.uses === 'actions/checkout@v4').with['persist-credentials']).toBe(false);
  expect(steps.find(step => step.uses === 'pnpm/action-setup@v4').with.version).toBe('11.19.0');
  expect(steps.find(step => step.uses === 'actions/setup-node@v4').with['node-version']).toBe('24');
  const install = steps.find(step => step.run === 'pnpm install --frozen-lockfile');
  expect(install.env).toBeUndefined();
  const privileged = steps.filter(step => step.env?.CLOUDFLARE_API_TOKEN);
  expect(privileged.map(step => step.name)).toEqual(['Create and smoke preview', 'Verify server ownership and clean preview resources']);
  expect(steps.indexOf(install)).toBeLessThan(steps.indexOf(privileged[0]));
  expect(privileged[0].run).toContain('--account "$CLOUDFLARE_ACCOUNT_ID" --name "$PREVIEW_NAME"');
  expect(privileged[0].run).toContain('--state .cossack/preview.json --smoke / --json');
});

it('persists only journals around always-run cleanup and restores an explicit same-repository prior artifact', async () => {
  const { text, value } = await workflow();
  const steps = value.jobs.preview.steps;
  const restore = steps.find(step => step.uses === 'actions/download-artifact@v4');
  expect(restore.if).toBe("inputs.operation == 'cleanup'");
  expect(restore.with).toMatchObject({ name: '${{ inputs.journal_artifact }}', 'run-id': '${{ inputs.source_run_id }}', repository: '${{ github.repository }}', path: '.cossack' });
  expect(value.on.workflow_dispatch.inputs.journal_artifact.options).toEqual(['cossack-preview-journal', 'cossack-preview-intent']);
  const uploads = steps.filter(step => step.uses === 'actions/upload-artifact@v4');
  expect(uploads).toHaveLength(2);
  for (const step of uploads) {
    expect(step.if).toBe('always()');
    expect(step.with.path).toBe('.cossack/preview.json');
    expect(step.with['include-hidden-files']).toBe(true);
    expect(step.with['retention-days']).toBe(7);
  }
  const cleanup = steps.find(step => step.name === 'Verify server ownership and clean preview resources');
  expect(cleanup.if).toContain('always()');
  expect(cleanup.if).toContain("steps.inputs.outcome == 'success'");
  expect(cleanup.run.indexOf('preview inspect')).toBeLessThan(cleanup.run.indexOf('preview cleanup'));
  expect(cleanup.run).toContain('preview inspect --account "$CLOUDFLARE_ACCOUNT_ID"');
  expect(cleanup.run).toContain('preview cleanup --account "$CLOUDFLARE_ACCOUNT_ID"');
  expect(text).toContain('intent alone never authorizes');
  expect(text).toContain('requires manual provider recovery');
  expect(steps.indexOf(uploads[0])).toBeLessThan(steps.indexOf(cleanup));
  expect(steps.indexOf(cleanup)).toBeLessThan(steps.indexOf(uploads[1]));
  expect(text).toContain('CLI rejects unsupported/shared production bindings');
  expect(text).toContain('Code rollback does not restore database or object data');
  expect(steps.filter(step => step.run).map(step => step.run).join('\n')).not.toMatch(/wrangler (?:deploy|delete)|preview promote|--env production/);
});

it('validates input values as data before provisioning or restoring journals', async () => {
  const { value } = await workflow();
  const script = value.jobs.preview.steps.find(step => step.id === 'inputs').run;
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), OPERATION: 'create', PREVIEW_NAME: 'pr-42', SOURCE_RUN_ID: '' };
  expect(execFileSync('bash', ['-c', script], { env, encoding: 'utf8' })).toBe('');
  for (const changes of [{ PREVIEW_NAME: 'pr-42; touch /tmp/unsafe' }, { CLOUDFLARE_ACCOUNT_ID: '' }, { OPERATION: 'cleanup', SOURCE_RUN_ID: '../123' }, { OPERATION: 'promote' }]) {
    expect(() => execFileSync('bash', ['-c', script], { env: { ...env, ...changes }, stdio: 'pipe' })).toThrow();
  }
  expect(execFileSync('bash', ['-c', script], { env: { ...env, OPERATION: 'cleanup', SOURCE_RUN_ID: '12345' }, encoding: 'utf8' })).toBe('');
});

it('executes verified cleanup in order and never deletes if inspection fails or the journal is missing', async () => {
  const { value } = await workflow();
  const script = value.jobs.preview.steps.find(step => step.name === 'Verify server ownership and clean preview resources').run;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-preview-ci-'));
  try {
    await fs.mkdir(path.join(root, 'bin'));
    await fs.mkdir(path.join(root, '.cossack'));
    await fs.writeFile(path.join(root, '.cossack/preview.json'), '{}');
    await fs.writeFile(path.join(root, 'bin/pnpm'), '#!/bin/bash\nprintf "%s\\n" "$*" >> "$COMMAND_LOG"\nif [[ "$*" == *"preview inspect"* && "${FAIL_INSPECT:-}" == 1 ]]; then exit 1; fi\n', { mode: 0o755 });
    const log = path.join(root, 'commands');
    const env = { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, COMMAND_LOG: log, FAIL_INSPECT: '', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) };
    execFileSync('bash', ['-c', script], { cwd: root, env, stdio: 'pipe' });
    expect((await fs.readFile(log, 'utf8')).trim().split('\n')).toEqual([`exec cossack preview inspect --account ${'a'.repeat(32)} --state .cossack/preview.json --json`, `exec cossack preview cleanup --account ${'a'.repeat(32)} --state .cossack/preview.json --json`]);
    await fs.writeFile(log, '');
    expect(() => execFileSync('bash', ['-c', script], { cwd: root, env: { ...env, FAIL_INSPECT: '1' }, stdio: 'pipe' })).toThrow();
    expect(await fs.readFile(log, 'utf8')).not.toContain('preview cleanup');
    await fs.rm(path.join(root, '.cossack/preview.json'));
    await fs.writeFile(log, '');
    expect(() => execFileSync('bash', ['-c', script], { cwd: root, env, stdio: 'pipe' })).toThrow();
    expect(await fs.readFile(log, 'utf8')).toBe('');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
