import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** A longer event timeout preserves the native hibernation opportunity.
 * This changes fixture data only: no provider patch or inferred Waiting state.
 */
export function extendWaitingTimeout(bundle) {
  const old = 'waitForEvent(`approval`,`approved`,{timeout:3e5})';
  assert.equal(bundle.split(old).length - 1, 1, 'Expected exactly one retained approval event barrier');
  return bundle.replace(old, 'waitForEvent(`approval`,`approved`,{timeout:9e5})');
}

export function retryReadResponse(op, status) {
  return ['audit', 'inspect', 'nativeStatus'].includes(op) && [502, 503, 504].includes(status);
}

export function parseCliReceipt(stdout) {
  return stdout.trim() ? JSON.parse(stdout) : null;
}

export async function pollWorkflowState({ read, expected, timeoutMs = 30000, intervalMs = 1000 }) {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = await read();
    if (value.status === expected) return value;
    if (value.code && value.code !== 'WORKFLOW_PROVIDER_UNAVAILABLE')
      throw new Error('Unexpected workflow polling failure');
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (Date.now() <= deadline);
  throw new Error(`Missing native ${expected}`);
}

/** Opt-in real deployment using a retained installed production fixture.
 * Every cloud mutation belongs to fresh random names with immutable receipts.
 */
export async function verifyHostedWaiting({ retainedRoot, idleMs = 330000 }) {
  assert.ok(idleMs >= 330000 && idleMs <= 360000, 'Idle probe must exceed the five-minute local grace hypothesis');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-workflow-waiting-20261009-'));
  await fs.chmod(root, 0o700);
  const app = path.join(root, 'app');
  await fs.mkdir(app);
  await fs.cp(path.join(retainedRoot, 'app/dist'), path.join(app, 'dist'), { recursive: true });
  const original = JSON.parse(await fs.readFile(path.join(retainedRoot, 'plan.json'), 'utf8'));
  const configPath = path.join(app, 'dist/ssr/wrangler.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const wrangler = path.join(retainedRoot, 'app/node_modules/wrangler/bin/wrangler.js');
  const stem = `cossack-wait-${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const owned = { accountId: original.accountId, worker: stem, workflow: `${stem}-flow`, database: `${stem}-db` };
  let sequence = 0;
  const save = async (name, value) =>
    fs.writeFile(path.join(root, name), JSON.stringify(value, null, 2), { mode: 0o600 });
  const command = async (label, binary, args) => {
    const name = `${String(++sequence).padStart(3, '0')}-${label}`;
    try {
      const result = await execute(binary, args, {
        cwd: app,
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: owned.accountId, VITEST: '', WRANGLER_SEND_METRICS: 'false' },
        timeout: 180000,
        maxBuffer: 16 * 1024 * 1024,
      });
      await fs.writeFile(path.join(root, `${name}.log`), result.stdout + result.stderr, { mode: 0o600 });
      return result.stdout;
    } catch (error) {
      await fs.writeFile(path.join(root, `${name}.log`), (error.stdout ?? '') + (error.stderr ?? ''), { mode: 0o600 });
      throw new Error(`${label} failed; private evidence: ${root}`);
    }
  };
  const cf = async (label, args) => parseCliReceipt(await command(label, 'cf', args));
  const native = (label, args) => command(label, process.execPath, [wrangler, ...args]);
  await save('owned.json', owned);
  const accounts = await cf('accounts', ['accounts', 'list']);
  assert.ok(accounts.some((account) => account.id === owned.accountId));
  assert.deepEqual(await cf('workers-before', ['workers', 'scripts', 'search', '--name', owned.worker]), []);
  assert.deepEqual(await cf('workflows-before', ['workflows', 'list', '--search', owned.workflow]), []);
  assert.deepEqual(await cf('databases-before', ['d1', 'list', '--name', owned.database]), []);
  let workflow, worker, database;
  let ownedNamespaces = [];
  const namespacesBefore = await cf('namespaces-before', ['durable-objects', 'namespaces', 'list']);
  const secret = randomUUID();
  const secretPath = path.join(root, 'secrets.json');
  await save('secrets.json', { APP_SECRET: randomUUID(), ACCEPTANCE_KEY: secret });
  const receipts = [];
  let origin;
  const call = async (op, values = {}, expected = 200) => {
    const deadline = Date.now() + 30000;
    while (true) {
      const response = await fetch(`${origin}/api/workflow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0',
          'X-Cossack-Acceptance-Key': secret,
        },
        body: JSON.stringify({ op, ...values }),
        signal: AbortSignal.timeout(30000),
      });
      const raw = await response.text();
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        value = null;
      }
      receipts.push({ op, status: response.status, raw, value, timestamp: Date.now() });
      await save('http-receipts.json', receipts);
      if (retryReadResponse(op, response.status) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      assert.ok(value && typeof value === 'object', `${op} non-JSON HTTP ${response.status}; evidence: ${root}`);
      if (expected !== null) assert.equal(response.status, expected, `${op} HTTP result; private evidence: ${root}`);
      else
        assert.ok(
          response.status === 200 || (response.status === 400 && value.code === 'WORKFLOW_PROVIDER_UNAVAILABLE'),
          `${op} unexpected HTTP result; private evidence: ${root}`,
        );
      return value;
    }
  };
  const idle = async (label) => {
    await save(`${label}-started.json`, {
      timestamp: Date.now(),
      idleMs,
      hypothesis: 'Native hibernation may require more than five minutes; local source is not proof of hosted timing',
    });
    // No requests to the instance during this interval.
    await new Promise((resolve) => setTimeout(resolve, idleMs));
    await save(`${label}-finished.json`, { timestamp: Date.now() });
  };
  const proveWaiting = async (identity, label) => {
    await idle(label);
    const provider = await cf(`${label}-provider`, [
      'workflows',
      'instances',
      'get',
      identity.id,
      '--workflow-name',
      owned.workflow,
    ]);
    await save(`${label}-provider.json`, provider);
    assert.equal(provider.status, 'waiting', `Literal provider Waiting missing; evidence: ${root}`);
    assert.equal((await call('nativeStatus', { identity })).status, 'waiting');
    assert.equal((await call('inspect', { identity })).status, 'waiting');
  };
  const poll = (identity, expected) =>
    pollWorkflowState({
      read: () => call('inspect', { identity }, null),
      expected,
    });

  try {
    database = await cf('database-create', ['d1', 'create', '--name', owned.database]);
    assert.equal(database.name, owned.database);
    assert.ok(database.uuid);
    owned.databaseId = database.uuid;
    await save('owned.json', owned);
    config.name = owned.worker;
    config.topLevelName = owned.worker;
    delete config.configPath;
    delete config.userConfigPath;
    config.workflows[0].name = owned.workflow;
    config.d1_databases[0].database_name = owned.database;
    config.d1_databases[0].database_id = database.uuid;
    config.upload_source_maps = false;
    await fs.writeFile(configPath, JSON.stringify(config));
    const entry = path.join(app, 'dist/ssr/index.js');
    await fs.writeFile(entry, extendWaitingTimeout(await fs.readFile(entry, 'utf8')));
    const deployment = await native('deploy', ['deploy', '--config', configPath, '--secrets-file', secretPath]);
    origin = deployment.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
    assert.ok(origin);
    workflow = await cf('workflow-created', ['workflows', 'get', owned.workflow]);
    assert.equal(workflow.name, owned.workflow);
    assert.equal(workflow.script_name, owned.worker);
    assert.ok(workflow.id);
    const workers = await cf('worker-created', ['workers', 'scripts', 'search', '--name', owned.worker]);
    assert.equal(workers.length, 1);
    worker = workers[0];
    assert.equal(worker.script_name, owned.worker);
    assert.ok(worker.id);
    const namespacesCreated = await cf('namespaces-created', ['durable-objects', 'namespaces', 'list']);
    ownedNamespaces = namespacesCreated.filter(
      (item) => item.script === owned.worker && !namespacesBefore.some((old) => old.id === item.id),
    );
    assert.equal(ownedNamespaces.length, 1);
    await save('owned-namespaces.json', ownedNamespaces);
    await save('provider-ownership.json', { worker, workflow, database });
    // Invalid identity exercises edge readiness without invoking or modifying any instance.
    assert.equal((await call('inspect', {}, 400)).code, 'ACCEPTANCE_IDENTITY_INVALID');
    const identity = await call('invoke', { key: `approval-${randomUUID()}` });
    await save('identity.json', identity);
    const barrierDeadline = Date.now() + 30000;
    let effects;
    do {
      effects = await call('audit', { identity });
      if (
        JSON.stringify(effects) ===
        JSON.stringify([
          { kind: 'attempt', n: 2 },
          { kind: 'first', n: 1 },
        ])
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } while (Date.now() < barrierDeadline);
    assert.deepEqual(effects, [
      { kind: 'attempt', n: 2 },
      { kind: 'first', n: 1 },
    ]);
    await proveWaiting(identity, 'first-wait');
    assert.deepEqual(await call('audit', { identity }), [
      { kind: 'attempt', n: 2 },
      { kind: 'first', n: 1 },
    ]);
    await call('pause', { identity });
    await poll(identity, 'paused');
    await call('resume', { identity });
    await proveWaiting(identity, 'resumed-wait');
    await call('event', { identity, payload: { approved: 'invalid' } }, 400);
    await call('event', { identity, payload: { approved: true } });
    await poll(identity, 'complete');
    assert.deepEqual(await call('audit', { identity }), [
      { kind: 'approved', n: 1 },
      { kind: 'attempt', n: 2 },
      { kind: 'first', n: 1 },
      { kind: 'last', n: 1 },
    ]);
    const failed = await call('invoke', { key: `failure-${randomUUID()}`, mode: 'failure' });
    const inspection = await poll(failed, 'failed');
    assert.equal(inspection.code, 'WORKFLOW_FAILED');
    assert.doesNotMatch(JSON.stringify(inspection), /PRIVATE_|payload|output|message/);
    await save('verified.json', {
      literalProviderWaiting: true,
      nativeBindingWaiting: true,
      inspectionWaiting: true,
      pauseResume: true,
      retryEventEffects: true,
      terminalFailure: true,
    });
    return { root, verified: true };
  } finally {
    // Receipts are rediscovered after a deployment failure before guarded deletion.
    const workflows = await cf('workflow-cleanup-list', ['workflows', 'list', '--search', owned.workflow]);
    const matching = workflows.filter((item) => item.name === owned.workflow && item.script_name === owned.worker);
    if (matching.length) {
      assert.ok(workflow, `Workflow creation receipt missing; manual recovery required: ${root}`);
      assert.equal(matching.length, 1);
      const current = await cf('workflow-before-delete', ['workflows', 'get', owned.workflow]);
      assert.equal(current.id, workflow.id);
      assert.equal(current.created_on, workflow.created_on);
      assert.equal(current.script_name, owned.worker);
      await cf('workflow-delete', ['workflows', 'delete', owned.workflow, '--force']);
    }
    const workers = await cf('worker-cleanup-list', ['workers', 'scripts', 'search', '--name', owned.worker]);
    if (workers.length === 1) {
      assert.ok(worker, `Worker creation receipt missing; manual recovery required: ${root}`);
      const current = workers[0];
      assert.equal(current.script_name, owned.worker);
      assert.equal(current.id, worker.id);
      assert.equal(current.created_on, worker.created_on);
      await save('worker-before-delete.json', current);
      await native('worker-delete', ['delete', '--config', configPath, '--force']);
    }
    if (database) {
      const databases = await cf('database-before-delete', ['d1', 'list', '--name', owned.database]);
      assert.equal(databases.length, 1);
      assert.equal(databases[0].uuid, database.uuid);
      await cf('database-delete', ['d1', 'delete', database.uuid, '--force']);
    }
    assert.deepEqual(await cf('workers-after', ['workers', 'scripts', 'search', '--name', owned.worker]), []);
    assert.deepEqual(await cf('workflows-after', ['workflows', 'list', '--search', owned.workflow]), []);
    assert.deepEqual(await cf('databases-after', ['d1', 'list', '--name', owned.database]), []);
    const namespacesAfter = await cf('namespaces-after', ['durable-objects', 'namespaces', 'list']);
    const newNamespaces = namespacesAfter.filter((item) => !namespacesBefore.some((old) => old.id === item.id));
    assert.ok(!newNamespaces.some((item) => item.script === owned.worker || item.script_name === owned.worker));
    assert.ok(!namespacesAfter.some((item) => ownedNamespaces.some((ownedNamespace) => ownedNamespace.id === item.id)));
    await save('cleaned.json', {
      workerAbsent: true,
      workflowAbsent: true,
      databaseAbsent: true,
      ownedNamespaceAbsent: true,
      evidence: root,
    });
    console.log(`Native Waiting evidence and cleanup: ${root}`);
  }
}
