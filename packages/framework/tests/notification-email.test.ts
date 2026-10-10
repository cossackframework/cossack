import { expect, it, vi } from 'vitest';
import { createCloudflareNotificationEmailProvider } from '../src/notifications/email';
import { isNotificationDeliveryError } from '@cossackframework/core/notifications';
const message = { to: 'recipient@example.test', from: 'sender@example.test', subject: 'Subject', html: '<p>body</p>', text: 'body' };
it('adapts the documented Workers structured binding and reports acceptance rather than delivery', async () => {
  const send = vi.fn(async () => ({ messageId: 'fixture-id' }));
  const provider = createCloudflareNotificationEmailProvider({ send });
  expect(provider.idempotency).toBe('none');
  expect(await provider.send({ ...message, injected: 'PRIVATE_UNDECLARED' } as typeof message, { idempotencyKey: 'PRIVATE_KEY' })).toEqual({ status: 'provider-accepted', messageId: 'fixture-id' });
  expect(send).toHaveBeenCalledExactlyOnceWith(message);
});
it.each(['E_SENDER_NOT_VERIFIED', 'E_VALIDATION_ERROR', 'E_RECIPIENT_NOT_ALLOWED', 'E_RATE_LIMIT_EXCEEDED'])('classifies explicit %s rejection without leaking errors', async code => {
  const provider = createCloudflareNotificationEmailProvider({ async send() { throw Object.assign(Error('PRIVATE_RAW_ERROR'), { code, secret: 'PRIVATE_SECRET' }); } });
  const error = await provider.send(message, { idempotencyKey: 'key' }).catch(error => error);
  expect(isNotificationDeliveryError(error)).toBe(true); expect(error.outcome).toBe('rejected');
  expect(JSON.stringify(error)).not.toContain('PRIVATE_'); expect(error.message).not.toContain('PRIVATE_');
});
it('treats unknown transport failures as uncertain and never automatically retries', async () => {
  const send = vi.fn(async () => { throw Error('PRIVATE_TOKEN'); });
  const provider = createCloudflareNotificationEmailProvider({ send });
  await expect(provider.send(message, { idempotencyKey: 'key' })).rejects.toMatchObject({ outcome: 'unknown' });
  expect(send).toHaveBeenCalledTimes(1);
});
it('does not invoke error accessors and rejects malformed acceptance as uncertain', async () => {
  let accessed = 0;
  const provider = createCloudflareNotificationEmailProvider({ async send() { throw { get code() { accessed++; return 'E_VALIDATION_ERROR'; } }; } });
  await expect(provider.send(message, { idempotencyKey: 'key' })).rejects.toMatchObject({ outcome: 'unknown' }); expect(accessed).toBe(0);
  const malformed = createCloudflareNotificationEmailProvider({ async send() { return { messageId: '\nPRIVATE_RAW_RESULT' }; } });
  await expect(malformed.send(message, { idempotencyKey: 'key' })).rejects.toMatchObject({ outcome: 'unknown' });
});
it('rejects unsafe or oversized messages before calling a binding', async () => {
  const send = vi.fn(async () => ({ messageId: 'id' })); const provider = createCloudflareNotificationEmailProvider({ send });
  await expect(provider.send({ ...message, subject: 'subject\nInjected: value' }, { idempotencyKey: 'key' })).rejects.toMatchObject({ outcome: 'rejected' });
  await expect(provider.send({ ...message, html: 'x'.repeat(256 * 1024) }, { idempotencyKey: 'key' })).rejects.toMatchObject({ outcome: 'rejected' });
  expect(send).not.toHaveBeenCalled();
});
