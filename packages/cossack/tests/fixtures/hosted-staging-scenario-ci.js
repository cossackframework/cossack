import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  createHostedPreviewCommandRecorder,
  downloadHostedPreviewJournals,
} from './cloudflare-preview-hosted-ci.js';

const migrationStep = `      - name: Apply explicit staging migration plan and build staging artifact
        if: inputs.operation == 'create' && steps.inputs.outcome == 'success'
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          COSSACK_ACCEPTANCE_ACCOUNT_ID: \${{ vars.CLOUDFLARE_ACCOUNT_ID }}
          COSSACK_ACCEPTANCE_STAGING_DATABASE_ID: \${{ vars.COSSACK_ACCEPTANCE_STAGING_DATABASE_ID }}
        run: node scripts/acceptance-ci.mjs migrate
`;
const smokeStep = `      - name: Verify protected assets and RPC against staging preview
        if: inputs.operation == 'create'
        env:
          COSSACK_PREVIEW_SECRETS_JSON: \${{ secrets.COSSACK_PREVIEW_SECRETS_JSON }}
          COSSACK_ACCEPTANCE_PREVIEW_JOURNAL: .cossack/preview.json
        run: node scripts/acceptance-ci.mjs smoke
`;
const artifactStep = `      - name: Preserve staging scenario evidence
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: cossack-staging-scenario
          path: .cossack/scenario-*.json
          include-hidden-files: true
          if-no-files-found: warn
          retention-days: 7
`;

/** Acceptance-only additions to the reviewed manual workflow; original trust and cleanup steps remain byte-identical. */
export function deriveHostedStagingWorkflow(template) {
  const create = '      - name: Create and smoke preview\n';
  const preserve = '      # The CLI atomically writes intent before the first remote mutation.';
  const final = '      - name: Preserve final ownership journal even on failure or cancellation\n';
  for (const anchor of [create, preserve, final])
    assert.equal(template.split(anchor).length, 2, 'Expected exactly one reviewed workflow anchor');
  assert.ok(template.includes('workflow_dispatch:') && !template.includes('pull_request_target:'), 'Trusted manual workflow required');
  return template.replace(create, migrationStep + create)
    .replace(preserve, smokeStep + preserve)
    .replace(final, artifactStep + final);
}

const digest = value => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex');
const owner = value => typeof value?.preview?.id === 'string' && value.preview.id.length > 0 &&
  typeof value.preview.createdOn === 'string' && value.preview.createdOn.length > 0 &&
  typeof value.deployment?.id === 'string' && value.deployment.id.length > 0 &&
  /^cossack:[a-f0-9]{32}$/.test(value.tag ?? '');
const sameOwner = (a, b) => owner(a) && owner(b) &&
  ['accountId', 'worker', 'name', 'tag'].every(key => a[key] === b[key]) &&
  a.preview.id === b.preview.id && a.preview.createdOn === b.preview.createdOn && a.deployment.id === b.deployment.id;

/** Does not turn synthetic verifier regression inputs into provider acceptance. */
export function verifyHostedStagingScenario(evidence) {
  const missing = [];
  const require = (ok, criterion) => { if (!ok) missing.push(criterion); };
  const { resources, run, intent, final, migration, smoke, before, after } = evidence ?? {};
  require(run?.event === 'workflow_dispatch' && run.status === 'completed' && run.conclusion === 'success' &&
    run.head_sha === evidence.headSha, 'Successful immutable manually dispatched hosted run');
  require(evidence?.workflowDerived === true && evidence.installedTarballs === true, 'Reviewed derived workflow and retained installed tarballs');
  require(resources?.productionD1 && resources?.stagingD1 && resources.productionD1 !== resources.stagingD1,
    'Distinct intended production and staging databases');
  require(intent?.status === 'deployed' && final?.status === 'cleaned' && sameOwner(intent, final) &&
    intent.accountId === resources?.accountId && intent.worker === resources?.worker,
    'Exact immutable owned preview journal survives cleanup');
  require(evidence?.remoteAbsent === true, 'Independent provider preview absence');
  require(intent?.resources?.some(r => r.kind === 'd1_databases' && r.ownership === 'existing-staging' && r.cleanup === 'retain'),
    'Preview cleanup retains the existing staging database');
  require(before?.production?.settings && before.production.deployments && digest(before.production) === digest(after?.production),
    'Production Worker settings and active deployments unchanged');
  require(Array.isArray(before?.productionD1?.schema) && before.productionD1.sentinel?.scope === 'production' &&
    digest(before.productionD1) === digest(after?.productionD1), 'Full production D1 schema and sentinel unchanged');
  require(before?.stagingD1?.sentinel?.scope === 'staging' && after?.stagingD1?.sentinel?.scope === 'staging',
    'Existing staging database independently retained');
  const target = migration?.plan?.target;
  require(target?.provider === 'd1' && target.target === 'remote' && target.environment === 'staging' &&
    target.binding === 'DB' && target.accountId === resources?.accountId && target.databaseId === resources?.stagingD1,
    'Explicit public migration plan identifies exact staging target');
  require(migration?.schemaVersion === 1 && migration?.applied === true && Array.isArray(migration.appliedNames) &&
    migration.appliedNames.length === 1 && migration.appliedNames[0] === migration.plan?.name && migration?.artifact?.accountId === resources?.accountId && migration?.artifact?.environment === 'staging' &&
    migration.artifact.databaseId === resources?.stagingD1, 'Plan applied and staging artifact built');
  require(typeof migration?.plan?.checksum === 'string' && migration.plan.checksum.length > 0 &&
    migration.verification?.historyChecksum === migration.plan.checksum && migration.verification.pendingAfter === 0 &&
    Array.isArray(migration.plan.statements) && migration.plan.statements.length === 1 &&
    migration.plan.statements[0].text?.includes('CREATE TABLE scenario_effects') && migration.plan.statements[0].parameterCount === 0,
    'Exact planned schema statement and checksum applied, with no pending migrations');
  require(typeof intent?.url === 'string' && intent.url.startsWith('https://') && smoke?.url === intent.url,
    'Protected network checks target the exact owned preview URL');
  require(smoke?.protectedAsset?.anonymousStatus === 401 && smoke.protectedAsset.authorizedStatus === 200 && smoke.protectedAsset.markerVerified === true,
    'Actual protected asset rejects anonymous access and accepts authorized access');
  require(smoke?.rpc?.anonymousStatus === 401 && smoke.rpc.authorizedStatus === 200 &&
    smoke.rpc.effectsBefore === 0 && smoke.rpc.effectsAfter === 1 && smoke.rpc.anonymousEffectsAfter === 0 &&
    smoke.rpc.returnVerified === true && smoke.schemaVersion === 1 && smoke.stagingRows?.before === 0 && smoke.stagingRows.after === 1,
    'Actual protected RPC rejects anonymous access without effects and produces one authorized effect');
  require(after?.stagingD1?.effects === 1, 'Independent staging D1 confirms exactly one accepted RPC effect');
  return { passed: missing.length === 0, missing };
}

/** One hosted composition run; caller retains exclusive provisioning and immutable resource teardown ownership. */
export async function runHostedStagingScenarioCI(options) {
  const { repo, repoId, accountId, worker, productionD1, stagingD1, evidenceDirectory, artifactDirectory } = options;
  const ref = options.ref ?? 'main';
  assert.match(repo, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(accountId, /^[a-f0-9]{32}$/i);
  assert.match(worker, /^[a-z0-9-]+$/);
  for (const id of [productionD1, stagingD1]) assert.match(id, /^[a-f0-9-]{36}$/i);
  assert.notEqual(productionD1, stagingD1);
  assert.ok(process.env.CLOUDFLARE_API_TOKEN);
  const commands = await createHostedPreviewCommandRecorder(evidenceDirectory);
  const gh = commands.json;
  const save = commands.privateJSON;
  let sequence = 0;
  const cf = async (endpoint, body) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
    });
    const parsed = await response.json();
    await save(`staging-cf-${++sequence}.json`, { endpoint, status: response.status, body: parsed });
    return { status: response.status, parsed };
  };
  const query = async (id, sql) => {
    const { status, parsed } = await cf(`/d1/database/${id}/query`, { sql, params: [] });
    assert.equal(status, 200);
    assert.equal(parsed.success, true);
    assert.equal(parsed.result?.[0]?.success, true);
    return parsed.result[0].results;
  };
  const database = async (id, completed) => ({
    schema: await query(id, 'SELECT name, sql FROM sqlite_schema ORDER BY name'),
    sentinel: (await query(id, 'SELECT scope, visits FROM cf09_acceptance WHERE id = 1'))[0],
    ...(completed && id === stagingD1 ? {
      effects: (await query(id, 'SELECT COUNT(*) AS effects FROM scenario_effects'))[0]?.effects,
    } : {}),
  });
  const snapshot = async completed => {
    const settings = await cf(`/workers/scripts/${worker}/settings`);
    const deployments = await cf(`/workers/scripts/${worker}/deployments`);
    assert.equal(settings.parsed.success, true);
    assert.equal(deployments.parsed.success, true);
    return { production: { settings: settings.parsed.result, deployments: deployments.parsed.result },
      productionD1: await database(productionD1, false), stagingD1: await database(stagingD1, completed) };
  };
  const identity = await gh(['api', `repos/${repo}`]);
  assert.equal(identity.id, repoId);
  assert.equal(identity.private, true);
  const commit = await gh(['api', `repos/${repo}/commits/${encodeURIComponent(ref)}`]);
  const headSha = commit.sha;
  assert.match(headSha, /^[a-f0-9]{40}$/);
  const suffix = `?ref=${headSha}`;
  const content = async name => {
    const result = await gh(['api', `repos/${repo}/contents/${name}${suffix}`]);
    assert.equal(result.encoding, 'base64');
    return Buffer.from(result.content, 'base64').toString('utf8');
  };
  assert.equal(await content('.github/workflows/preview.yml'), await fs.readFile(options.expectedWorkflowFile, 'utf8'),
    'Hosted workflow differs from reviewed derived acceptance workflow');
  const pkg = JSON.parse(await content('package.json'));
  const internal = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([name]) =>
    (name.startsWith('@cossackframework/') && name !== '@cossackframework/solar-icons') || name === 'cossack');
  assert.ok(internal.some(([name]) => name === 'cossack') && internal.some(([name]) => name === '@cossackframework/database'));
  assert.ok(internal.every(([, target]) => /^file:\.\/acceptance-artifacts\/[^/]+\.tgz$/.test(target)));
  for (const filename of ['pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
    const text = await content(filename);
    assert.ok(!text.includes('/tmp/') && !text.includes('workspace:') && !text.includes('file:..'),
      'Hosted dependency metadata contains local/workspace paths');
  }
  const tree = await gh(['api', `repos/${repo}/git/trees/${commit.commit.tree.sha}?recursive=1`]);
  assert.equal(tree.truncated, false);
  const artifacts = await fs.readdir(artifactDirectory);
  assert.ok(artifacts.length > 0);
  for (const entry of artifacts) {
    assert.ok(entry.endsWith('.tgz') && !entry.includes('/'));
    const bytes = await fs.readFile(path.join(artifactDirectory, entry));
    const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(tree.tree.find(item => item.path === `acceptance-artifacts/${entry}`)?.sha, sha);
  }
  const before = await snapshot(false);
  await save('staging-before.json', before);
  const started = Date.now();
  // Dispatch is intentionally never retried: a lost POST response requires preserving ownership and inspecting provider state.
  await gh(['api', '--method', 'POST', `repos/${repo}/actions/workflows/preview.yml/dispatches`,
    '-f', `ref=${ref}`, '-f', 'inputs[operation]=create', '-f', `inputs[preview_name]=staging-${started}`,
    '-f', 'inputs[journal_artifact]=cossack-preview-intent']);
  const deadline = Date.now() + 30 * 60_000;
  let runId, run;
  while (Date.now() < deadline) {
    if (!runId) {
      const runs = await gh(['api', `repos/${repo}/actions/workflows/preview.yml/runs?event=workflow_dispatch&per_page=30`]);
      const found = runs.workflow_runs.filter(candidate => candidate.head_sha === headSha &&
        Date.parse(candidate.created_at) >= started - 2000);
      assert.ok(found.length <= 1, 'Ambiguous workflow dispatch ownership');
      runId = found[0]?.id;
      if (runId) await save('staging-dispatch.json', { repo, repoId, headSha, runId, started });
    }
    if (runId) {
      run = await gh(['api', `repos/${repo}/actions/runs/${runId}`]);
      assert.equal(run.head_sha, headSha);
      assert.equal(run.event, 'workflow_dispatch');
      if (run.status === 'completed') break;
    }
    await new Promise(resolve => setTimeout(resolve, 15_000));
  }
  assert.equal(run?.status, 'completed', 'Hosted deadline elapsed; retain repository and ownership resources');
  // Diagnostics precede artifact reads even when the new composition fails.
  const journals = await downloadHostedPreviewJournals(commands, repo, run, evidenceDirectory);
  const directory = path.join(evidenceDirectory, String(runId), 'scenario');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await commands.raw(['run', 'download', String(runId), '--repo', repo, '--name', 'cossack-staging-scenario', '--dir', directory]);
  const receipt = async name => {
    const filename = path.join(directory, name);
    await fs.chmod(filename, 0o600);
    return JSON.parse(await fs.readFile(filename, 'utf8'));
  };
  const migration = await receipt('scenario-migration.json');
  const smoke = await receipt('scenario-smoke.json');
  assert.ok(owner(journals.intent) && journals.intent.accountId === accountId && journals.intent.worker === worker,
    'Preview ownership must match before independent provider read');
  const absent = await cf(`/workers/workers/${worker}/previews/${encodeURIComponent(journals.intent.preview.id)}`);
  const after = await snapshot(true);
  const evidence = { resources: { accountId, worker, productionD1, stagingD1 }, headSha, run, ...journals,
    migration, smoke, before, after, remoteAbsent: absent.status === 404, workflowDerived: true, installedTarballs: true };
  await save('staging-evidence.json', evidence);
  const verification = verifyHostedStagingScenario(evidence);
  await save('staging-verification.json', verification);
  assert.equal(verification.passed, true, verification.missing.join('; '));
  return { passed: true, runId, evidenceDirectory };
}
