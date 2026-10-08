import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { runHostedPreviewCI, verifyHostedPreviewCI } from './fixtures/cloudflare-preview-hosted-ci.js';

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
