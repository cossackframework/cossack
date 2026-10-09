import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';
const execute = promisify(execFile);
const repository = path.resolve(fileURLToPath(new URL('../../../..', import.meta.url)));

export async function verifyBackgroundReleaseScenario(installedRoot) {
  const consumer = await fs.realpath(installedRoot);
  const relative = path.relative(repository, consumer);
  assert(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
  const requireConsumer = createRequire(path.join(consumer, 'package.json'));
  const cli = await fs.realpath(requireConsumer.resolve('cossack/bin/cossack.js'));
  assert(cli.startsWith(consumer + path.sep) && cli.includes('@file+'));
  const evidence = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-background-scenario-'));
  const root = path.join(evidence, 'app');
  let server;
  let sequence = 0;
  async function command(binary, args, cwd = root) {
    try {
      const result = await execute(binary, args, {
        cwd,
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([name]) => !/^(CLOUDFLARE_|CF_|DENO_DEPLOY_)/.test(name)),
          ),
          NODE_ENV: 'production',
          VITEST: '',
          WRANGLER_SEND_METRICS: 'false',
        },
      });
      await fs.writeFile(path.join(evidence, `${++sequence}-command.log`), result.stdout + result.stderr, {
        mode: 0o600,
      });
      return result;
    } catch (error) {
      const log = path.join(evidence, `${++sequence}-command.log`);
      await fs.writeFile(log, (error.stdout ?? '') + (error.stderr ?? ''), { mode: 0o600 });
      throw new Error(`Background scenario command failed; private evidence: ${log}`, { cause: error });
    }
  }
  async function poll(read, valid, label) {
    const deadline = Date.now() + 30000;
    let value;
    while (Date.now() < deadline) {
      value = await read();
      if (valid(value)) return value;
      await delay(100);
    }
    throw new Error(`Background scenario ${label} deadline; last value: ${JSON.stringify(value)}; ${evidence}`);
  }
  try {
    const created = JSON.parse(
      (
        await command(
          process.execPath,
          [
            cli,
            'create',
            'app',
            '--adapter=cloudflare',
            '--preset=minimal',
            '--features=notifications',
            '--yes',
            '--json',
          ],
          evidence,
        )
      ).stdout,
    );
    assert(
      created.ok &&
        created.data.recipe.resolvedFeatures.includes('jobs') &&
        created.data.recipe.resolvedFeatures.includes('notifications'),
    );
    // Private top-level links prevent Vite's caches from mutating the retained
    // installed consumer. All actual dependencies resolve to its tarballs/tools.
    const modules = path.join(root, 'node_modules');
    await fs.mkdir(modules);
    for (const item of await fs.readdir(path.join(consumer, 'node_modules'), { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue;
      const source = path.join(consumer, 'node_modules', item.name);
      const target = path.join(modules, item.name);
      if (item.name.startsWith('@')) {
        await fs.mkdir(target);
        for (const name of await fs.readdir(source))
          await fs.symlink(await fs.realpath(path.join(source, name)), path.join(target, name), 'dir');
      } else await fs.symlink(await fs.realpath(source), target, 'dir');
    }
    const artifacts = {};
    for (const name of ['core', 'framework', 'renderer']) {
      const resolved = await fs.realpath(path.join(modules, '@cossackframework', name));
      assert(resolved.startsWith(consumer + path.sep) && resolved.includes('@file+'));
      const metadata = await fs.readFile(path.join(resolved, 'package.json'));
      artifacts[name] = {
        path: resolved,
        version: JSON.parse(metadata.toString()).version,
        packageSha256: createHash('sha256').update(metadata).digest('hex'),
      };
    }
    const requireCli = createRequire(cli);
    for (const [name, directory] of [
      ['cossack', path.dirname(path.dirname(cli))],
      ['scaffold', path.dirname(requireCli.resolve('@cossackframework/scaffold/package.json'))],
    ]) {
      const resolved = await fs.realpath(directory);
      assert(resolved.startsWith(consumer + path.sep) && resolved.includes('@file+'));
      const metadata = await fs.readFile(path.join(resolved, 'package.json'));
      artifacts[name] = {
        path: resolved,
        version: JSON.parse(metadata.toString()).version,
        packageSha256: createHash('sha256').update(metadata).digest('hex'),
      };
    }
    const consumerPackage = JSON.parse(await fs.readFile(path.join(consumer, 'package.json'), 'utf8'));
    const manifestFile = path.join(root, 'package.json');
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    for (const [name, reference] of Object.entries(consumerPackage.dependencies))
      if (reference.startsWith('file:'))
        manifest.dependencies[name] = `file:${path.resolve(consumer, reference.slice(5))}`;
    manifest.packageManager = consumerPackage.packageManager;
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    const notificationsFile = path.join(root, 'src/notifications/index.ts');
    let notifications = await fs.readFile(notificationsFile, 'utf8');
    assert(notifications.includes('async preferences({ recipient, template, channel }) {'));
    notifications = notifications.replace(
      'async preferences({ recipient, template, channel }) {',
      `async preferences({ recipient, template, channel }) {
      const delivery = await env.JOB_STATE.prepare('SELECT attempt FROM cossack_notifications WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1').bind(recipient.tenantId,recipient.userId).first<{attempt:number}>();
      if (delivery?.attempt === 1) {
        const failed = await env.JOB_STATE.prepare('UPDATE scenario_control SET fail_once=0 WHERE user_id=? AND fail_once=1 RETURNING user_id').bind(recipient.userId).first();
        if (failed) throw new Error('controlled transient preference lookup failure');
      }`,
    );
    notifications = notifications.replace('idempotencyKey: id,', 'idempotencyKey: id, delaySeconds: 2,');
    await fs.writeFile(notificationsFile, notifications);
    const jobsFile = path.join(root, 'src/jobs/index.ts');
    let jobs = await fs.readFile(jobsFile, 'utf8');
    const oldHandler = 'async handle(payload) { await createNotifications(env).deliver(payload.id); }';
    assert(jobs.includes(oldHandler));
    jobs = jobs.replace(
      oldHandler,
      `retryDelaySeconds: 5,
      async handle(payload, context) {
        // A consumer-owned borrowed D1 facility is created only after native
        // delivery. D1 bindings have no close API; this scoped facade must release.
        let active = true;
        const facility = {
          async run(sql: string, ...values: (string|number)[]) { if (!active) throw new Error('released consumer facility'); return env.JOB_STATE.prepare(sql).bind(...values).run(); },
          async release() { if (!active) throw new Error('double release'); active=false; await env.JOB_STATE.prepare('UPDATE scenario_attempts SET cleaned_at=? WHERE notification_id=? AND attempt=?').bind(Date.now(),payload.id,context.attempt).run(); }
        };
        context.onCleanup(()=>facility.release());
        await facility.run('INSERT INTO scenario_attempts (notification_id,attempt,started_at,context_json) VALUES (?,?,?,?)',payload.id,context.attempt,Date.now(),JSON.stringify({id:context.id,key:context.key,attempt:context.attempt,scope:context.scope}));
        await createNotifications(env).deliver(payload.id);
      }`,
    );
    await fs.writeFile(jobsFile, jobs);
    const entryFile = path.join(root, 'src/index.ts');
    let entry = await fs.readFile(entryFile, 'utf8');
    const oldQueue =
      'async queue(batch: MessageBatch, env: CloudflareBindings) { await createJobs(env).queue(batch); }';
    assert(entry.includes(oldQueue));
    entry = entry.replace(
      oldQueue,
      `async queue(batch: MessageBatch, env: CloudflareBindings) {
      for (const message of batch.messages) await env.JOB_STATE.prepare('INSERT INTO scenario_envelopes (body_json,attempt) VALUES (?,?)').bind(JSON.stringify(message.body),message.attempts).run();
      await createJobs(env).queue(batch);
    }`,
    );
    await fs.writeFile(entryFile, entry);
    await fs.mkdir(path.join(root, 'src/pages/api'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'src/pages/api/background.ts'),
      `import {createNotifications} from '../../notifications';
      import {createJobs} from '../../jobs';
      export const POST=async(c:any)=>{
        const data=await c.req.json(); const recipient={tenantId:'scenario-tenant',userId:data.user==='optout'?'optout':'enabled'};
        // Request-owned data is reduced to explicit JSON identifiers/content.
        // This prepared statement stays in this request scope and is never queued.
        const requestFacility=c.env.JOB_STATE.prepare('INSERT INTO scenario_requests (request_id,returned_at) VALUES (?,?)');
        const requestId=crypto.randomUUID();
        const result=await createNotifications(c.env).enqueue('notice',{title:'Background notice',body:data.body},{recipient,channel:'in-app',idempotencyKey:data.key});
        await requestFacility.bind(requestId,Date.now()).run();
        return c.json({...result,requestId},202);
      };
      export const PUT=async(c:any)=>{
        const invalid=[{payload:{id:'invalid',request:c.req.raw},scope:{}},{payload:{id:'invalid',database:c.env.JOB_STATE},scope:{}},{payload:{id:'invalid'},scope:{request:c.req.raw}}];
        let rejected=0; for(const entry of invalid) {try {await createJobs(c.env).dispatch('deliverNotification',entry.payload as any,{scope:entry.scope as any});} catch {rejected++;}}
        return c.json({rejected});
      };`,
    );
    await fs.writeFile(
      path.join(root, 'src/jobs/migrations/0003_scenario.sql'),
      `CREATE TABLE scenario_control(user_id TEXT PRIMARY KEY,fail_once INTEGER NOT NULL);
      CREATE TABLE scenario_requests(request_id TEXT PRIMARY KEY,returned_at INTEGER NOT NULL);
      CREATE TABLE scenario_attempts(notification_id TEXT NOT NULL,attempt INTEGER NOT NULL,started_at INTEGER NOT NULL,cleaned_at INTEGER,context_json TEXT NOT NULL,PRIMARY KEY(notification_id,attempt));
      CREATE TABLE scenario_envelopes(body_json TEXT NOT NULL,attempt INTEGER NOT NULL);`,
    );
    const configFile = path.join(root, 'wrangler.jsonc');
    const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
    config.queues.consumers[0].max_batch_size = 1;
    config.queues.consumers[0].max_batch_timeout = 1;
    await fs.writeFile(configFile, JSON.stringify(config, null, 2));
    const vite = path.join(path.dirname(requireConsumer.resolve('vite/package.json')), 'bin/vite.js');
    await command(process.execPath, [vite, 'build', '--configLoader', 'runner']);
    const wrangler = path.join(path.dirname(requireConsumer.resolve('wrangler/package.json')), 'bin/wrangler.js');
    await command(process.execPath, [wrangler, 'types', '--env-interface', 'CloudflareBindings']);
    const tsc = path.join(path.dirname(requireConsumer.resolve('typescript/package.json')), 'bin/tsc');
    await command(process.execPath, [tsc, '--noEmit']);
    server = createTestHarness({ root, workers: [{ configPath: path.join(root, 'dist/ssr/wrangler.json') }] });
    await server.listen();
    const worker = server.getWorker();
    const env = await worker.getEnv();
    await worker.applyD1Migrations('JOB_STATE');
    const all = async (sql, ...params) =>
      (
        await env.JOB_STATE.prepare(sql)
          .bind(...params)
          .all()
      ).results;
    const state = async (id) => {
      // One native D1 batch avoids mixing an earlier notification snapshot with
      // a later job snapshot while the consumer is committing its outcome.
      const result = await env.JOB_STATE.batch([
        env.JOB_STATE.prepare('SELECT id,status,attempt,code FROM cossack_notifications WHERE id=?').bind(id),
        env.JOB_STATE.prepare(
          "SELECT * FROM cossack_jobs WHERE key IN (SELECT json_extract(body_json,'$.key') FROM scenario_envelopes WHERE json_extract(body_json,'$.payload.id')=?)",
        ).bind(id),
      ]);
      return { notification: result[0].results[0], job: result[1].results[0] };
    };
    const snapshots = [];
    for (const user of ['enabled', 'optout']) {
      await env.JOB_STATE.prepare(
        "INSERT INTO cossack_notification_preferences VALUES ('scenario-tenant',?,'notice','in-app',1)",
      )
        .bind(user)
        .run();
      await env.JOB_STATE.prepare('INSERT INTO scenario_control VALUES (?,1)').bind(user).run();
      const response = await worker.fetch('http://localhost/api/background', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-private-request-marker': 'NEVER_QUEUE_OR_RETAIN_REQUEST' },
        body: JSON.stringify({ user, body: 'serialized notification content', key: `scenario-${user}` }),
      });
      assert.equal(response.status, 202);
      const dispatched = await response.json();
      assert.equal(dispatched.status, 'queued');
      assert.equal(
        (await all('SELECT COUNT(*) AS count FROM scenario_attempts WHERE notification_id=?', dispatched.id))[0].count,
        0,
        'The server operation must return before consumer work starts',
      );
      assert.equal(
        (await all('SELECT COUNT(*) AS count FROM scenario_requests WHERE request_id=?', dispatched.requestId))[0]
          .count,
        1,
      );
      const retrying = await poll(
        () => state(dispatched.id),
        (value) =>
          value.job?.status === 'retrying' &&
          value.notification?.status === 'queued' &&
          value.notification.attempt === 1 &&
          value.notification.code === 'NOTIFICATION_PREFERENCES_UNAVAILABLE',
        'native transient retry',
      );
      assert.equal(retrying.job.attempt, 1);
      assert.equal(retrying.job.code, 'JOB_TRANSIENT_FAILURE');
      assert.equal(retrying.notification.attempt, 1);
      assert.equal(retrying.notification.code, 'NOTIFICATION_PREFERENCES_UNAVAILABLE');
      if (user === 'optout')
        await env.JOB_STATE.prepare(
          "UPDATE cossack_notification_preferences SET enabled=0 WHERE tenant_id='scenario-tenant' AND user_id=?",
        )
          .bind(user)
          .run();
      const finished = await poll(
        () => state(dispatched.id),
        (value) => value.job?.status === 'completed',
        'native retry completion',
      );
      assert.equal(finished.job.attempt, 2);
      assert.equal(finished.notification.attempt, 2);
      assert.equal(finished.notification.status, user === 'enabled' ? 'delivered' : 'failed');
      assert.equal(finished.notification.code, user === 'enabled' ? null : 'NOTIFICATION_PREFERENCE_DISABLED');
      const attempts = await poll(
        () => all('SELECT * FROM scenario_attempts WHERE notification_id=? ORDER BY attempt', dispatched.id),
        (rows) => rows.length === 2 && rows.every((row) => row.cleaned_at !== null),
        'consumer cleanup receipts',
      );
      assert.equal(attempts.length, 2);
      const request = (
        await all('SELECT returned_at FROM scenario_requests WHERE request_id=?', dispatched.requestId)
      )[0];
      for (const attempt of attempts) {
        assert(attempt.started_at > request.returned_at);
        assert(attempt.cleaned_at >= attempt.started_at);
        assert.deepEqual(JSON.parse(attempt.context_json).scope, { tenantId: 'scenario-tenant', actorId: user });
      }
      const inbox = await all(
        "SELECT id FROM cossack_notifications WHERE user_id=? AND channel='in-app' AND status='delivered'",
        user,
      );
      assert.equal(inbox.length, user === 'enabled' ? 1 : 0);
      snapshots.push({ user, dispatched, request, retrying, finished, attempts, inbox });
    }
    const rejectedResponse = await worker.fetch('http://localhost/api/background', { method: 'PUT' });
    assert.equal(rejectedResponse.status, 200);
    assert.deepEqual(await rejectedResponse.json(), { rejected: 3 });
    const envelopes = await all('SELECT * FROM scenario_envelopes ORDER BY rowid');
    assert.equal(envelopes.length, 4);
    for (const row of envelopes) {
      const envelope = JSON.parse(row.body_json);
      assert.deepEqual(Object.keys(envelope).sort(), [
        'createdAt',
        'id',
        'job',
        'key',
        'namespace',
        'payload',
        'scope',
        'version',
      ]);
      assert.deepEqual(Object.keys(envelope.payload), ['id']);
      assert.deepEqual(Object.keys(envelope.scope).sort(), ['actorId', 'tenantId']);
      assert(!row.body_json.includes('NEVER_QUEUE_OR_RETAIN_REQUEST'));
      assert.equal(envelope.job, 'deliverNotification');
    }
    assert.equal((await all('SELECT COUNT(*) AS count FROM cossack_jobs'))[0].count, 2);
    const result = {
      evidence,
      artifacts,
      cli,
      snapshots,
      envelopes,
      rejectedNonSerializableInputs: 3,
      native: 'local-workerd-Queue-and-D1',
      email: 'not-exercised',
    };
    await fs.writeFile(path.join(evidence, 'verified.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    return result;
  } finally {
    let nativeHarnessClosed = !server;
    try {
      await server?.close();
      nativeHarnessClosed = true;
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.writeFile(
        path.join(evidence, 'cleaned.json'),
        JSON.stringify({ nativeHarnessClosed, privateApplicationRemoved: true }),
        { mode: 0o600 },
      );
    }
  }
}
