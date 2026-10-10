import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { deriveHostedStagingWorkflow, verifyHostedStagingScenario, runHostedStagingScenarioCI } from './fixtures/hosted-staging-scenario-ci.js';
const { parse } = createRequire(import.meta.resolve('@cossackframework/scaffold/package.json'))('yaml');

const proof = () => {
  const resources = { accountId: 'a'.repeat(32), worker: 'acceptance-owned', productionD1: 'production-id', stagingD1: 'staging-id' };
  const intent = { schemaVersion: 1, status: 'deployed', accountId: resources.accountId, worker: resources.worker,
    name: 'staging-owned', url: 'https://owned-preview.example.com', tag: `cossack:${'b'.repeat(32)}`, preview: { id: 'preview-id', createdOn: '2026-10-09T00:00:00Z' },
    deployment: { id: 'deployment-id' }, resources: [{ kind: 'd1_databases', ownership: 'existing-staging', cleanup: 'retain' }] };
  const before = { production: { settings: { id: 'worker-id' }, deployments: { active: 'immutable-version' } },
    productionD1: { schema: [{ name: 'cf09_acceptance', sql: 'CREATE TABLE cf09_acceptance (...)' }], sentinel: { scope: 'production', visits: 0 } },
    stagingD1: { sentinel: { scope: 'staging', visits: 0 } } };
  return { resources, headSha: 'c'.repeat(40), run: { event: 'workflow_dispatch', status: 'completed', conclusion: 'success', head_sha: 'c'.repeat(40) },
    intent, final: { ...intent, status: 'cleaned' }, before, after: { ...structuredClone(before), stagingD1: { sentinel: { scope: 'staging', visits: 1 }, effects: 1 } },
    migration: { schemaVersion: 1, plan: { name: 'create_effects', checksum: 'migration-checksum', statements: [{ text: 'CREATE TABLE scenario_effects (...)', parameterCount: 0 }], target: { provider: 'd1', target: 'remote', environment: 'staging', binding: 'DB', accountId: resources.accountId, databaseId: resources.stagingD1 } },
      applied: true, appliedNames: ['create_effects'], verification: { historyChecksum: 'migration-checksum', pendingAfter: 0 }, artifact: { environment: 'staging', accountId: resources.accountId, databaseId: resources.stagingD1 } },
    smoke: { schemaVersion: 1, url: intent.url, protectedAsset: { anonymousStatus: 401, authorizedStatus: 200, markerVerified: true },
      rpc: { anonymousStatus: 401, authorizedStatus: 200, effectsBefore: 0, effectsAfter: 1, anonymousEffectsAfter: 0, returnVerified: true }, stagingRows: { before: 0, after: 1 } },
    remoteAbsent: true, workflowDerived: true, installedTarballs: true };
};

describe('hosted staging workflow derivation', () => {
  it('adds bounded acceptance steps while preserving every reviewed original step and trust gate', async () => {
    const original = await fs.readFile(new URL('../../scaffold/template/.github/workflows/preview.yml', import.meta.url), 'utf8');
    const derived = deriveHostedStagingWorkflow(original);
    const base = parse(original), result = parse(derived);
    expect(result.on).toEqual(base.on);
    expect(result.permissions).toEqual(base.permissions);
    expect(result.concurrency).toEqual(base.concurrency);
    const steps = result.jobs.preview.steps;
    const additions = steps.filter(step => !base.jobs.preview.steps.some(candidate => JSON.stringify(candidate) === JSON.stringify(step)));
    expect(additions).toHaveLength(3);
    expect(steps.filter(step => !additions.includes(step))).toEqual(base.jobs.preview.steps);
    const migrate = additions.find(step => step.run?.endsWith(' migrate'));
    const smoke = additions.find(step => step.run?.endsWith(' smoke'));
    expect(migrate.env.CLOUDFLARE_API_TOKEN).toBe('${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(migrate.env.COSSACK_ACCEPTANCE_STAGING_DATABASE_ID).toBe('${{ vars.COSSACK_ACCEPTANCE_STAGING_DATABASE_ID }}');
    expect(smoke.env).not.toHaveProperty('CLOUDFLARE_API_TOKEN');
    expect(smoke.env.COSSACK_ACCEPTANCE_PREVIEW_JOURNAL).toBe('.cossack/preview.json');
    expect(steps.indexOf(migrate)).toBeLessThan(steps.findIndex(step => step.id === 'create'));
    expect(steps.indexOf(smoke)).toBeGreaterThan(steps.findIndex(step => step.id === 'create'));
    expect(steps.indexOf(smoke)).toBeLessThan(steps.findIndex(step => step.name?.includes('clean preview resources')));
    expect(additions.find(step => step.uses === 'actions/upload-artifact@v4').if).toBe('always()');
  });
  it('fails closed for drifted or duplicated reviewed workflow anchors', () => {
    expect(() => deriveHostedStagingWorkflow('workflow_dispatch:\n')).toThrow('anchor');
    const duplicate = '      - name: Create and smoke preview\n'.repeat(2);
    expect(() => deriveHostedStagingWorkflow(duplicate)).toThrow('anchor');
  });
});

describe('hosted staging evidence verifier regressions (synthetic inputs, no hosted acceptance claim)', () => {
  it('recognizes the complete evidence shape', () => expect(verifyHostedStagingScenario(proof())).toEqual({ passed: true, missing: [] }));
  it.each([
    ['migration targets production', value => { value.migration.plan.target.databaseId = value.resources.productionD1; }],
    ['staging artifact uses production', value => { value.migration.artifact.databaseId = value.resources.productionD1; }],
    ['applied checksum changed', value => { value.migration.verification.historyChecksum = 'changed'; }],
    ['migration still pending', value => { value.migration.verification.pendingAfter = 1; }],
    ['plan was not applied', value => { value.migration.appliedNames = []; }],
    ['unauthenticated asset exposed', value => { value.smoke.protectedAsset.anonymousStatus = 200; }],
    ['unauthenticated RPC produced side effect', value => { value.smoke.rpc.anonymousEffectsAfter = 1; }],
    ['independent D1 differs', value => { value.after.stagingD1.effects = 2; }],
    ['production schema altered', value => { value.after.productionD1.schema.push({ name: 'scenario_effects', sql: 'CREATE TABLE scenario_effects (...)' }); }],
    ['preview owner swapped', value => { value.final.preview = { ...value.final.preview, id: 'foreign-id' }; }],
    ['run SHA changed', value => { value.run.head_sha = 'd'.repeat(40); }],
    ['network smoke belongs to another preview', value => { value.smoke.url = 'https://foreign-preview.example.com'; }],
    ['migration used another binding', value => { value.migration.plan.target.binding = 'OTHER'; }],
    ['unplanned migrations applied', value => { value.migration.appliedNames.push('foreign-migration'); }],
    ['absence unchecked', value => { value.remoteAbsent = false; }],
  ])('rejects %s', (_, mutate) => { const value = proof(); mutate(value); expect(verifyHostedStagingScenario(value).passed).toBe(false); });
});

// Provider acceptance is opt-in; deterministic verifier cases above do not substitute for this run.
it.skipIf(!process.env.COSSACK_HOSTED_STAGING_OPTIONS)('actual hosted staging migration, protected resources and preview cleanup', async () => {
  const options = JSON.parse(await fs.readFile(process.env.COSSACK_HOSTED_STAGING_OPTIONS, 'utf8'));
  const result = await runHostedStagingScenarioCI(options);
  expect(result.passed).toBe(true);
  expect(result.runId).toBeGreaterThan(0);
}, 30 * 60_000);
