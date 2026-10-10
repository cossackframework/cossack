import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export async function verifyHostedLocalSmoke(root, secrets) {
  const require = createRequire(path.join(root, 'package.json'));
  const harness = require('wrangler').createTestHarness({ root, workers: [{ configPath: path.join(root, 'dist/ssr/wrangler.json'), secrets }] });
  try {
    const origin = new URL((await harness.listen()).url).origin;
    const call = async (op, values = {}, authenticated = true, endpoint = '/api/workflow') => {
      const response = await fetch(origin + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { 'X-Cossack-Acceptance-Key': secrets.ACCEPTANCE_KEY } : {}) }, body: JSON.stringify({ op, ...values }), signal: AbortSignal.timeout(10000) });
      const text = await response.text();
      assert.ok(!text.includes(secrets.ACCEPTANCE_KEY) && !text.includes(secrets.APP_SECRET));
      return { status: response.status, value: JSON.parse(text), text };
    };
    const until = async condition => {
      const deadline = Date.now() + 30000;
      do { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < deadline);
      throw new Error('Local hosted-fixture condition was not established');
    };
    assert.equal((await call('invoke', { key: 'guarded' }, false)).status, 401);
    assert.equal((await call(null, {}, false, '/api/acceptance-exception')).status, 401);
    const exception = await call(null, {}, true, '/api/acceptance-exception');
    assert.equal(exception.status, 500);
    assert.equal(exception.value.code, 'COSSACK_REQUEST_INTERNAL');
    assert.match(exception.value.requestId, /^[0-9a-f-]{36}$/i);
    assert.ok(!exception.text.includes('PRIVATE_HOSTED_API_EXCEPTION'));
    const invocation = await call('invoke', { key: 'local-hosted-fixture' });
    assert.equal(invocation.status, 200);
    const identity = invocation.value;
    await until(async () => JSON.stringify((await call('audit', { identity })).value) === JSON.stringify([{ kind: 'attempt', n: 2 }, { kind: 'first', n: 1 }]));
    assert.equal((await call('event', { identity, payload: { approved: true } })).status, 200);
    await until(async () => (await call('inspect', { identity })).value.status === 'complete');
    assert.deepEqual((await call('audit', { identity })).value, [{ kind: 'approved', n: 1 }, { kind: 'attempt', n: 2 }, { kind: 'first', n: 1 }, { kind: 'last', n: 1 }]);
    const failed = await call('invoke', { key: 'local-hosted-failure', mode: 'failure' });
    assert.equal(failed.status, 200);
    await until(async () => (await call('inspect', { identity: failed.value })).value.status === 'failed');
    const failure = await call('inspect', { identity: failed.value });
    assert.equal(failure.value.code, 'WORKFLOW_FAILED');
    assert.ok(!failure.text.includes('PRIVATE_HOSTED_WORKFLOW_FAILURE'));
  } finally { await harness.close(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [root, secretsPath, ...extra] = process.argv.slice(2);
    if (extra.length || !root || !secretsPath || !path.isAbsolute(root) || !path.isAbsolute(secretsPath)) throw new Error('Invalid local smoke paths');
    await verifyHostedLocalSmoke(root, JSON.parse(await fs.readFile(secretsPath, 'utf8')));
    console.log('Local hosted-fixture smoke passed; no hosted evidence claimed.');
  } catch (error) {
    const root = process.argv[2];
    if (root && path.isAbsolute(root)) {
      await fs.writeFile(path.join(root, 'private-smoke-failure.log'), String(error?.stack ?? error), { mode: 0o600 }).catch(() => {});
    }
    console.error('Local hosted-fixture smoke failed; inspect the private app diagnostics.');
    process.exitCode = 1;
  }
}
