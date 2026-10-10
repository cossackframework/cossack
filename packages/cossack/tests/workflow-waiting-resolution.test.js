import { expect, it } from 'vitest';
import {
  extendWaitingTimeout,
  verifyHostedWaiting,
  parseCliReceipt,
  retryReadResponse,
  pollWorkflowState,
} from './fixtures/workflow-waiting-resolution.js';

it('extends only the retained fixture event deadline without changing native status behavior', () => {
  const barrier = 'waitForEvent(`approval`,`approved`,{timeout:3e5})';
  expect(extendWaitingTimeout(`before ${barrier} after`)).toBe(
    'before waitForEvent(`approval`,`approved`,{timeout:9e5}) after',
  );
  expect(() => extendWaitingTimeout('missing')).toThrow('Expected exactly one');
  expect(() => extendWaitingTimeout(barrier + barrier)).toThrow('Expected exactly one');
});

it.skipIf(!process.env.COSSACK_WORKFLOW_WAITING_RETAINED_ROOT)(
  'proves literal hosted Waiting after an uninterrupted native idle interval and guarded cleanup',
  async () => {
    const result = await verifyHostedWaiting({ retainedRoot: process.env.COSSACK_WORKFLOW_WAITING_RETAINED_ROOT });
    expect(result.verified).toBe(true);
  },
  1000000,
);

it('retains successful empty provider deletion receipts without masking the acceptance result', () => {
  expect(parseCliReceipt('')).toBeNull();
  expect(parseCliReceipt('  \n')).toBeNull();
  expect(parseCliReceipt('{"status":"waiting"}')).toEqual({ status: 'waiting' });
  expect(() => parseCliReceipt('malformed')).toThrow();
});
it('polls only through known transient provider unavailability and still requires the literal native state', async () => {
  let count = 0;
  await expect(
    pollWorkflowState({
      read: async () => (++count === 1 ? { code: 'WORKFLOW_PROVIDER_UNAVAILABLE' } : { status: 'paused' }),
      expected: 'paused',
      intervalMs: 0,
    }),
  ).resolves.toEqual({ status: 'paused' });
  expect(count).toBe(2);
  await expect(
    pollWorkflowState({ read: async () => ({ code: 'ACCEPTANCE_UNAUTHORIZED' }), expected: 'paused' }),
  ).rejects.toThrow('Unexpected workflow');
  await expect(
    pollWorkflowState({ read: async () => ({ status: 'running' }), expected: 'waiting', timeoutMs: 0 }),
  ).rejects.toThrow('Missing native waiting');
});

it('retries bounded provider readiness reads but never replays mutations or hides application failures', () => {
  for (const op of ['invoke', 'pause', 'resume', 'event', 'terminate']) {
    expect(retryReadResponse(op, 503)).toBe(false);
  }
  expect(retryReadResponse('inspect', 503)).toBe(true);
  expect(retryReadResponse('audit', 502)).toBe(true);
  expect(retryReadResponse('nativeStatus', 504)).toBe(true);
  expect(retryReadResponse('inspect', 500)).toBe(false);
  expect(retryReadResponse('audit', 400)).toBe(false);
});
