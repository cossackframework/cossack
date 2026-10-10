import { NotificationDeliveryError, type EmailDeliveryProvider } from '@cossackframework/core/notifications';
/** Narrow subset of the current Workers structured send_email binding. */
export interface CloudflareNotificationEmailBinding {
  send(message: { to: string; from: string; subject: string; html: string; text: string }): Promise<{ messageId: string }>;
}
const rejected = new Set(['E_VALIDATION_ERROR', 'E_FIELD_MISSING', 'E_TOO_MANY_RECIPIENTS', 'E_TOO_MANY_ATTACHMENTS',
  'E_SENDER_NOT_VERIFIED', 'E_RECIPIENT_NOT_ALLOWED', 'E_RECIPIENT_SUPPRESSED', 'E_SENDER_DOMAIN_NOT_AVAILABLE',
  'E_CONTENT_TOO_LARGE', 'E_DELIVERY_FAILED', 'E_RATE_LIMIT_EXCEEDED', 'E_DAILY_LIMIT_EXCEEDED',
  'E_HEADER_NOT_ALLOWED', 'E_HEADER_USE_API_FIELD', 'E_HEADER_VALUE_INVALID', 'E_HEADER_VALUE_TOO_LONG',
  'E_HEADER_NAME_INVALID', 'E_HEADERS_TOO_LARGE', 'E_HEADERS_TOO_MANY']);
function field(value: unknown, key: string): unknown {
  try { if (value && typeof value === 'object') { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && 'value' in descriptor ? descriptor.value : undefined; } } catch {}
  return undefined;
}
export function createCloudflareNotificationEmailProvider(binding: CloudflareNotificationEmailBinding): EmailDeliveryProvider {
  return Object.freeze({ idempotency: 'none' as const,
    async send(message: Parameters<EmailDeliveryProvider['send']>[0]) {
      // Copy only declared message fields; never forward arbitrary client headers or metadata.
      const { to, from, subject, html, text } = message;
      if (![to, from, subject, html, text].every(value => typeof value === 'string')
        || !to || !from || !subject || /[\r\n]/.test(to + from + subject)
        || new TextEncoder().encode(to + from + subject + html + text).byteLength > 256 * 1024) throw new NotificationDeliveryError('rejected');
      try {
        const result = await binding.send({ to, from, subject, html, text });
        const messageId = field(result, 'messageId');
        if (typeof messageId !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(messageId)) throw new NotificationDeliveryError('unknown');
        return Object.freeze({ status: 'provider-accepted' as const, messageId });
      } catch (error) {
        const code = field(error, 'code');
        if (typeof code === 'string' && rejected.has(code)) throw new NotificationDeliveryError('rejected', { retryable: code === 'E_RATE_LIMIT_EXCEEDED' || code === 'E_DAILY_LIMIT_EXCEEDED' });
        throw new NotificationDeliveryError('unknown');
      }
    },
  });
}
