import { expect, it, vi } from 'vitest';
import { createSmtpNotificationEmailProvider } from '../src/notifications';
import { createNodeEmailSender } from '../src/email';
const transport = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => transport } }));
const message = { to: 'recipient@example.test', from: 'sender@example.test', subject: 'Subject', html: '<p>body</p>', text: 'body' };
it('composes the existing SMTP factory without claiming provider idempotency or delivery', async () => {
  transport.sendMail.mockResolvedValueOnce({ messageId: 'smtp-id' });
  const sender = createNodeEmailSender({ host: 'fixture.invalid', port: 587, auth: { user: 'PRIVATE_USER', pass: 'PRIVATE_PASS' } });
  const provider = createSmtpNotificationEmailProvider(sender);
  expect(provider.idempotency).toBe('none');
  expect(await provider.send(message, { idempotencyKey: 'PRIVATE_KEY' })).toEqual({ status: 'provider-accepted', messageId: 'smtp-id' });
  expect(transport.sendMail).toHaveBeenCalledWith(expect.objectContaining(message));
  expect(transport.sendMail.mock.calls[0][0]).not.toHaveProperty('idempotencyKey');
});
it.each([450, 550])('classifies explicit SMTP %s rejection and excludes original fields', async responseCode => {
  const provider = createSmtpNotificationEmailProvider({ async send() { throw Object.assign(Error('PRIVATE_ERROR'), { responseCode, response: 'PRIVATE_RESPONSE' }); } });
  const error = await provider.send(message, { idempotencyKey: 'key' }).catch(error => error);
  expect(error).toMatchObject({ outcome: 'rejected', retryable: responseCode < 500 });
  expect(JSON.stringify(error)).not.toContain('PRIVATE_'); expect(error.message).not.toContain('PRIVATE_');
});
it('never retries an ambiguous SMTP failure or invokes error getters', async () => {
  let accessors = 0;
  const send = vi.fn(async () => { throw { get responseCode() { accessors++; return 450; } }; });
  const provider = createSmtpNotificationEmailProvider({ send });
  await expect(provider.send(message, { idempotencyKey: 'key' })).rejects.toMatchObject({ outcome: 'unknown' });
  expect(send).toHaveBeenCalledTimes(1); expect(accessors).toBe(0);
});
it('rejects unsafe message headers before SMTP I/O', async () => {
  const send = vi.fn(async () => ({ messageId: 'id' }));
  await expect(createSmtpNotificationEmailProvider({ send }).send({ ...message, from: 'sender@example.test\r\nBcc: private' }, { idempotencyKey: 'key' })).rejects.toMatchObject({ outcome: 'rejected' });
  expect(send).not.toHaveBeenCalled();
});
