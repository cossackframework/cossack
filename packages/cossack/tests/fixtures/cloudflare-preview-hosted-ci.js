import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const execute = promisify(execFile);
const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(value) ?? 'undefined')
    .digest('hex');
const hasOwner = (a) =>
  typeof a?.preview?.id === 'string' &&
  a.preview.id.length > 0 &&
  typeof a.preview.createdOn === 'string' &&
  a.preview.createdOn.length > 0 &&
  typeof a?.deployment?.id === 'string' &&
  a.deployment.id.length > 0 &&
  typeof a?.tag === 'string';
const sameOwner = (a, b) =>
  hasOwner(a) &&
  hasOwner(b) &&
  a?.preview?.id === b?.preview?.id &&
  a?.preview?.createdOn === b?.preview?.createdOn &&
  a?.deployment?.id === b?.deployment?.id &&
  a?.tag === b?.tag &&
  a?.name === b?.name &&
  a?.worker === b?.worker &&
  a?.accountId === b?.accountId;

/** Acceptance is evidence from actual GitHub runs and independently read provider state. */
export function verifyHostedPreviewCI(evidence) {
  const missing = [];
  const require = (ok, criterion) => {
    if (!ok) missing.push(criterion);
  };
  const { success, failure, retry } = evidence ?? {};
  require(success?.run?.event === 'workflow_dispatch' &&
    success.run.status === 'completed' &&
    success.run.conclusion === 'success', 'Successful actual manually dispatched create workflow');
  require(failure?.run?.event === 'workflow_dispatch' &&
    failure.run.status === 'completed' &&
    failure.run.conclusion === 'failure', 'Actual failed smoke workflow preserves its journal');
  require(retry?.run?.event === 'workflow_dispatch' &&
    retry.run.status === 'completed' &&
    retry.run.conclusion === 'success', 'Actual cleanup retry workflow restores earlier intent artifact');
  for (const [label, phase, status] of [
    ['success', success, 'deployed'],
    ['failure', failure, 'smoke-failed'],
  ]) {
    require(phase?.intent?.status === status &&
      phase.intent.schemaVersion === 1 &&
      hasOwner(phase.intent) &&
      /^cossack:[a-f0-9]{32}$/.test(phase.intent.tag ?? ''), `${label}: immutable tagged deployed intent artifact`);
    require(phase?.final?.status === 'cleaned' &&
      sameOwner(phase.intent, phase.final), `${label}: final cleaned artifact retains exact ownership`);
    require(phase?.remoteAbsent === true, `${label}: independent provider confirms preview absent`);
    require(phase?.intent?.resources?.some(
      (r) => r.kind === 'd1_databases' && r.ownership === 'existing-staging' && r.cleanup === 'retain',
    ), `${label}: staging D1 retained by preview cleanup`);
  }
  require(retry?.final?.status === 'cleaned' &&
    sameOwner(failure?.intent, retry?.final), 'Retry restores exact earlier immutable ownership');
  require(success?.intent?.preview?.id !==
    failure?.intent?.preview?.id, 'Independent creations have distinct immutable preview IDs');
  const before = evidence?.before,
    after = evidence?.after;
  require(before?.production?.settings &&
    before.production.deployments &&
    digest(before.production) ===
      digest(after?.production), 'Parent production settings and active deployment unchanged');
  require(before?.productionD1?.scope === 'production' &&
    before.productionD1.visits === 0 &&
    digest(before.productionD1) === digest(after?.productionD1), 'Production D1 sentinel and rows unchanged');
  require(before?.stagingD1?.scope === 'staging' &&
    before.stagingD1.visits === 0 &&
    after?.stagingD1?.scope === 'staging' &&
    after.stagingD1.visits >= 2, 'Both hosted smokes execute against distinct staging D1');
  require(typeof evidence?.resources?.productionD1 === 'string' &&
    evidence.resources.productionD1 !== evidence.resources.stagingD1 &&
    evidence.resources.accountId === success?.intent?.accountId &&
    success?.intent?.worker === evidence.resources.worker &&
    failure?.intent?.worker ===
      evidence.resources.worker, 'Actual receipts identify intended account, parent and distinct D1 bindings');
  require(evidence?.workflowUnchanged === true &&
    evidence?.installedTarballs ===
      true, 'Exact reviewed scaffold workflow and portable installed tarball dependencies');
  return { passed: missing.length === 0, missing };
}

/** Copies retained tarballs into a generated app so GitHub has no local absolute paths. */
export async function makePortableTarballApp(app, installedRoot) {
  const source = JSON.parse(await fs.readFile(path.join(installedRoot, 'package.json'), 'utf8'));
  const pkg = JSON.parse(await fs.readFile(path.join(app, 'package.json'), 'utf8'));
  const overrides = {};
  await fs.mkdir(path.join(app, 'acceptance-artifacts'), { recursive: true });
  for (const group of ['dependencies', 'devDependencies']) {
    for (const [name, target] of Object.entries(source[group] ?? {})) {
      if (!target.startsWith('file:') || (!name.startsWith('@cossackframework/') && name !== 'cossack')) continue;
      const basename = path.basename(target.slice(5));
      await fs.copyFile(target.slice(5), path.join(app, 'acceptance-artifacts', basename));
      overrides[name] = `file:./acceptance-artifacts/${basename}`;
      for (const ownedGroup of ['dependencies', 'devDependencies'])
        if (pkg[ownedGroup]?.[name]) pkg[ownedGroup][name] = overrides[name];
    }
  }
  assert.ok(overrides.cossack && overrides['@cossackframework/framework']);
  pkg.packageManager = 'pnpm@11.19.0';
  await fs.writeFile(path.join(app, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  await fs.writeFile(
    path.join(app, 'pnpm-workspace.yaml'),
    `packages:\n  - '.'\noverrides:\n${Object.entries(overrides)
      .map(([name, target]) => `  '${name}': '${target}'`)
      .join('\n')}\n`,
  );
  return overrides;
}

/** Caller supplies owned temporary repository/resource receipts; no token enters argv or evidence. */
export async function runHostedPreviewCI(options) {
  const { repo, repoId, accountId, worker, productionD1, stagingD1, successRef, failureRef, evidenceDirectory } =
    options;
  assert.match(repo, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(accountId, /^[a-f0-9]{32}$/i);
  assert.match(worker, /^[a-z0-9-]+$/);
  assert.ok(productionD1 !== stagingD1 && process.env.CLOUDFLARE_API_TOKEN);
  await fs.mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  let sequence = 0;
  const save = async (name, value) =>
    fs.writeFile(path.join(evidenceDirectory, name), JSON.stringify(value, null, 2), { mode: 0o600 });
  const gh = async (args) => {
    const filename = `gh-${++sequence}.json`;
    try {
      const result = await execute('gh', args, {
        timeout: 60_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GH_PROMPT_DISABLED: '1' },
      });
      await fs.writeFile(path.join(evidenceDirectory, filename), result.stdout, { mode: 0o600 });
      return result.stdout ? JSON.parse(result.stdout) : null;
    } catch (error) {
      throw new Error(`GitHub operation failed; private receipt ${filename}`, { cause: { code: error.code } });
    }
  };
  const cf = async (endpoint, body) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const parsed = await response.json();
    await save(`cf-${++sequence}.json`, { endpoint, status: response.status, body: parsed });
    return { response, parsed };
  };
  const query = async (id) => {
    const { response, parsed } = await cf(`/d1/database/${id}/query`, {
      sql: 'SELECT scope, visits FROM cf09_acceptance WHERE id = 1',
      params: [],
    });
    assert.equal(response.status, 200);
    assert.equal(parsed.success, true);
    return parsed.result[0].results[0];
  };
  const snapshot = async () => {
    const settings = await cf(`/workers/scripts/${worker}/settings`);
    const deployments = await cf(`/workers/scripts/${worker}/deployments`);
    assert.equal(settings.parsed.success, true);
    assert.equal(deployments.parsed.success, true);
    return {
      production: { settings: settings.parsed.result, deployments: deployments.parsed.result },
      productionD1: await query(productionD1),
      stagingD1: await query(stagingD1),
    };
  };
  const identity = await gh(['api', `repos/${repo}`]);
  assert.equal(identity.id, repoId);
  assert.equal(identity.private, true);
  const expectedWorkflow = await fs.readFile(options.expectedWorkflowFile, 'utf8');
  let workflowUnchanged = true,
    installedTarballs = true;
  for (const ref of [successRef, failureRef]) {
    const suffix = `?ref=${encodeURIComponent(ref)}`;
    const workflow = await gh(['api', `repos/${repo}/contents/.github/workflows/preview.yml${suffix}`]);
    workflowUnchanged &&= Buffer.from(workflow.content, 'base64').toString('utf8') === expectedWorkflow;
    const manifest = await gh(['api', `repos/${repo}/contents/package.json${suffix}`]);
    const pkg = JSON.parse(Buffer.from(manifest.content, 'base64').toString('utf8'));
    const internal = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(
      ([name]) =>
        (name.startsWith('@cossackframework/') && name !== '@cossackframework/solar-icons') || name === 'cossack',
    );
    installedTarballs &&=
      internal.length > 0 && internal.every(([, target]) => /^file:\.\/acceptance-artifacts\/[^/]+\.tgz$/.test(target));
    const workspace = await gh(['api', `repos/${repo}/contents/pnpm-workspace.yaml${suffix}`]);
    const workspaceText = Buffer.from(workspace.content, 'base64').toString('utf8');
    assert.ok(
      !workspaceText.includes('/tmp/') && !workspaceText.includes('workspace:') && !workspaceText.includes('file:..'),
      'Hosted overrides retained private/workspace paths',
    );
    const lock = await gh(['api', `repos/${repo}/contents/pnpm-lock.yaml${suffix}`]);
    const lockText = Buffer.from(lock.content, 'base64').toString('utf8');
    assert.ok(
      !lockText.includes('/tmp/') && !lockText.includes('workspace:'),
      'Hosted lock retained private/workspace paths',
    );
    const commit = await gh(['api', `repos/${repo}/commits/${encodeURIComponent(ref)}`]);
    const tree = await gh(['api', `repos/${repo}/git/trees/${commit.commit.tree.sha}?recursive=1`]);
    assert.equal(tree.truncated, false);
    for (const entry of await fs.readdir(options.artifactDirectory)) {
      assert.ok(entry.endsWith('.tgz') && !entry.includes('/'));
      const bytes = await fs.readFile(path.join(options.artifactDirectory, entry));
      const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      assert.equal(
        tree.tree.find((item) => item.path === `acceptance-artifacts/${entry}`)?.sha,
        blob,
        'Hosted tarball differs from retained installed artifact',
      );
    }
  }
  assert.equal(workflowUnchanged, true, 'Hosted workflow differs from installed reviewed scaffold template');
  assert.equal(installedTarballs, true, 'Hosted dependencies must use portable local tarballs');
  const before = await snapshot();
  await save('before.json', before);
  const run = async (ref, operation, sourceRun) => {
    const started = Date.now();
    const branch = await gh(['api', `repos/${repo}/commits/${encodeURIComponent(ref)}`]);
    const sha = branch.sha;
    const args = [
      'api',
      '--method',
      'POST',
      `repos/${repo}/actions/workflows/preview.yml/dispatches`,
      '-f',
      `ref=${ref}`,
      '-f',
      `inputs[operation]=${operation}`,
      '-f',
      `inputs[preview_name]=acceptance-${started}`,
      '-f',
      'inputs[journal_artifact]=cossack-preview-intent',
    ];
    if (sourceRun) args.push('-f', `inputs[source_run_id]=${sourceRun}`);
    await gh(args);
    const deadline = Date.now() + 30 * 60_000;
    let runId, current;
    while (Date.now() < deadline) {
      if (!runId) {
        const runs = await gh([
          'api',
          `repos/${repo}/actions/workflows/preview.yml/runs?event=workflow_dispatch&per_page=30`,
        ]);
        const found = runs.workflow_runs.filter(
          (candidate) => candidate.head_sha === sha && Date.parse(candidate.created_at) >= started - 2000,
        );
        assert.ok(found.length <= 1, 'Ambiguous workflow dispatch ownership');
        runId = found[0]?.id;
      }
      if (runId) {
        current = await gh(['api', `repos/${repo}/actions/runs/${runId}`]);
        assert.equal(current.head_sha, sha);
        if (current.status === 'completed') break;
      }
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
    assert.equal(
      current?.status,
      'completed',
      'Hosted workflow deadline elapsed; preserve repository and resource ownership',
    );
    const journals = {};
    for (const [key, name] of [
      ['intent', 'cossack-preview-intent'],
      ['final', 'cossack-preview-journal'],
    ]) {
      const directory = path.join(evidenceDirectory, String(runId), key);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await execute('gh', ['run', 'download', String(runId), '--repo', repo, '--name', name, '--dir', directory], {
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      });
      const file = path.join(directory, 'preview.json');
      await fs.chmod(file, 0o600);
      journals[key] = JSON.parse(await fs.readFile(file, 'utf8'));
    }
    const absent = await cf(`/workers/workers/${worker}/previews/${journals.intent.preview.id}`);
    const phase = { run: current, ...journals, remoteAbsent: absent.response.status === 404 };
    await save(`run-${runId}.json`, phase);
    return phase;
  };
  const success = await run(successRef, 'create');
  const failure = await run(failureRef, 'create');
  const retry = await run(failureRef, 'cleanup', failure.run.id);
  const after = await snapshot();
  const evidence = {
    success,
    failure,
    retry,
    before,
    after,
    resources: { accountId, worker, productionD1, stagingD1 },
    workflowUnchanged,
    installedTarballs,
  };
  await save('evidence.json', evidence);
  const verification = verifyHostedPreviewCI(evidence);
  await save('verification.json', verification);
  assert.equal(verification.passed, true, verification.missing.join('; '));
  return { passed: true, runIds: [success.run.id, failure.run.id, retry.run.id], evidenceDirectory };
}
