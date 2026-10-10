import { NotificationDeliveryError, type EmailDeliveryProvider } from '@cossackframework/core/notifications';
import type { NodeEmailSender } from './email';
/** Adapt createNodeEmailSender() or another explicit structural SMTP sender. */
export function createSmtpNotificationEmailProvider(sender: NodeEmailSender): EmailDeliveryProvider {
  return Object.freeze({ idempotency: 'none' as const,
    async send(message: Parameters<EmailDeliveryProvider['send']>[0]) {
      const { to, from, subject, html, text } = message;
      if (![to, from, subject, html, text].every(value => typeof value === 'string') || !to || !from || !subject
        || /[\r\n]/.test(to + from + subject)
        || new TextEncoder().encode(to + from + subject + html + text).byteLength > 256 * 1024) throw new NotificationDeliveryError('rejected');
      try {
        const result = await sender.send({ to, from, subject, html, text });
        const descriptor = result && typeof result === 'object' ? Object.getOwnPropertyDescriptor(result, 'messageId') : undefined;
        const messageId = descriptor && 'value' in descriptor ? descriptor.value : undefined;
        if (typeof messageId !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(messageId)) throw new NotificationDeliveryError('unknown');
        return Object.freeze({ status: 'provider-accepted' as const, messageId });
      } catch (error) {
        let responseCode: unknown;
        try { const descriptor = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'responseCode') : undefined;
          responseCode = descriptor && 'value' in descriptor ? descriptor.value : undefined;
        } catch {}
        if (typeof responseCode === 'number' && Number.isInteger(responseCode) && responseCode >= 400 && responseCode <= 599) {
          throw new NotificationDeliveryError('rejected', { retryable: responseCode < 500 });
        }
        throw new NotificationDeliveryError('unknown');
      }
    },
  });
}
