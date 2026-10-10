import { beforeAll, afterAll, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { prepareWorkflowFixture, workflowRequest } from './fixtures/workflow-failure-native.js';

let fixture, runtime, origin;
beforeAll(async () => {
  fixture = await prepareWorkflowFixture();
  runtime = fixture.makeRuntime();
  origin = new URL((await runtime.listen()).url).origin;
}, 180000);
afterAll(async () => {
  try { await runtime?.close(); } finally { if (fixture) await fs.rm(fixture.parent, { recursive: true, force: true }); }
});
const call = (op, values) => workflowRequest(origin, op, values);

it('retries an actual native step and consumes an external event through the generated public bridge', async () => {
  const invoked = await call('invoke', { key: 'native-event' });
  expect(invoked.status).toBe(200);
  const identity = invoked.value;
  expect(identity).toMatchObject({ name: 'approval', version: 1, scope: { tenantId: 'trusted-fixture', actorId: 'fixture-user' } });
  await expect.poll(async () => (await call('audit', { identity })).value, { timeout: 30000 }).toEqual([{ kind: 'attempt', n: 2 }, { kind: 'first', n: 1 }]);
  // Effects prove the retry; no claim about the provider's waiting status is made.
  const invalid = await call('event', { identity, payload: { approved: 'PRIVATE_BAD_EVENT' } });
  expect(invalid.status).toBe(400);
  expect(invalid.value).toEqual({ code: 'WORKFLOW_EVENT_INVALID' });
  expect(invalid.text).not.toContain('PRIVATE_BAD_EVENT');
  expect((await call('event', { identity, payload: { approved: true } })).value).toEqual({ ok: true });
  await expect.poll(async () => (await call('inspect', { identity })).value.status, { timeout: 30000 }).toBe('complete');
  expect((await call('audit', { identity })).value).toEqual([{ kind: 'approved', n: 1 }, { kind: 'attempt', n: 2 }, { kind: 'first', n: 1 }, { kind: 'last', n: 1 }]);
  const inspected = await call('inspect', { identity });
  expect(inspected.text).not.toMatch(/PRIVATE_|payload|output|message/);
}, 90000);

it('reports terminal native failure without leaking private provider errors', async () => {
  const invoked = await call('invoke', { key: 'native-failure', mode: 'failure' });
  expect(invoked.status).toBe(200);
  const identity = invoked.value;
  await expect.poll(async () => (await call('inspect', { identity })).value.status, { timeout: 30000 }).toBe('failed');
  const inspected = await call('inspect', { identity });
  expect(inspected.status).toBe(200);
  expect(inspected.value).toMatchObject({ status: 'failed', code: 'WORKFLOW_FAILED' });
  expect(inspected.text).not.toMatch(/PRIVATE_|payload|output|message/);
  expect((await call('audit', { identity })).value).toEqual([{ kind: 'failure', n: 1 }, { kind: 'first', n: 1 }]);
  // Read native status only inside this test to establish that a genuine provider failure occurred.
  const env = await runtime.getWorker().getEnv();
  const native = await (await env.WORKFLOWS.get(identity.id)).status();
  expect(native.status).toBe('errored');
  expect(JSON.stringify(native)).toContain('PRIVATE_NATIVE_WORKFLOW_FAILURE');
}, 60000);
