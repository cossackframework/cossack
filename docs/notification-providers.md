# Notification email providers and durable state

Use the notification runtime from `@cossackframework/core/notifications` with
explicit recipient preferences, a template registry, an application jobs dispatcher,
and an optional durable store. Preview renders a template without sending mail.
Choose a provider explicitly. Neither adapter sends during setup or preview.

## SMTP on Node

```ts
import { createNodeEmailSender } from '@cossackframework/node-adapter';
import { createSmtpNotificationEmailProvider } from '@cossackframework/node-adapter/notifications';

const provider = createSmtpNotificationEmailProvider(createNodeEmailSender({
  host: privateConfig.smtpHost,
  port: privateConfig.smtpPort,
  auth: { user: privateConfig.smtpUser, pass: privateConfig.smtpPassword },
}));
// Pass { provider, from: 'notifications@example.com' } to the runtime's email option.
```

The adapter copies only `to`, `from`, `subject`, `html`, and `text`. It does not
forward arbitrary headers or the runtime key to SMTP. Explicit numeric SMTP
400–599 rejection responses become fixed `NotificationDeliveryError('rejected')`
results. Temporary 400–499 responses are retryable. Other exceptions and malformed
acceptance results mean `unknown`. Errors never contain original SMTP messages,
responses, credentials, or body content. Header newlines and messages above the
adapter's 256 KiB UTF-8 bound reject before sender I/O.

## Cloudflare Workers

```ts
import { createCloudflareNotificationEmailProvider } from '@cossackframework/framework/notifications';
const provider = createCloudflareNotificationEmailProvider(env.EMAIL);
```

Configure `send_email: [{ name: 'EMAIL' }]` and use Wrangler-generated application
binding types. The adapter accepts a narrow structural subset of the current
Workers structured message builder and does not import Node or the ORM. Sender
domain onboarding and binding restrictions remain application deployment setup.
See the [Workers email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
and [binding restrictions](https://developers.cloudflare.com/email-service/configuration/send-bindings/).

Documented validation, sender/recipient, quota, rate, and header rejection codes
map to fixed rejection errors. Internal service and unrecognized errors remain
uncertain. No adapter echoes provider errors or automatically sends again.
Both adapters declare `idempotency: 'none'`. Neither documented API proves stable
provider-enforced idempotency. A resolved send means `provider-accepted`, never
`delivered`. Only authenticated provider delivery evidence matching the stored
message ID can advance email state to delivered.

## Durable D1 notification store

```ts
import { createD1NotificationStore, notificationStateSchema } from '@cossackframework/framework/notifications';
const store = createD1NotificationStore(env.NOTIFICATION_STATE);
// Apply notificationStateSchema through an explicit setup migration, not a request.
```

The SQL creates `cossack_notifications` and its inbox index. A separate binding is
optional: the generated notification recipe can reuse `JOB_STATE` while applying
the additional notification migration explicitly. The store requires only narrow
`prepare`/`bind`/`first`/`all`/`run` methods and no ORM package. Reads do not create
schema. Invalid persistence operations return fixed, redacted errors.

Records contain private template data, rendered content and recipient addresses.
Treat the database as private server storage with application retention/access
policies. The store's `get` and delivery methods are internal facilities. Expose
only the runtime's structural inspection and authorized in-app operations. Initial
records are bounded to 256 KiB of encoded JSON. Claims are time-bounded to at most
one day and use token fencing. Database updates atomically admit one owner.

The sending marker is persisted before provider I/O. A crash after a send starts
with no provider idempotency makes an expired claim terminal `unknown`. That
prevents blind resends. An explicitly rejected send can return to queued for a
safe retry. A provider that actually enforces the same key across restarts can
reclaim an uncertain claim. Changing that capability to `none` is rejected. Old
tokens cannot finish a newer claim, and accepted/failed/unknown/delivered states
survive restart.

This prevents automatic duplicate sends after known acceptance or uncertainty.
It does not guarantee exactly-once external delivery. Unknown sends need manual
provider reconciliation or an application-owned policy. Keep provider delivery
webhooks authenticated before calling `recordDelivered`.

In-app lists include only delivered records for the exact tenant and user.
Read/unread updates use the same identity filter and cannot change another inbox.
Recipient identity must come from trusted server authorization. A browser ID alone
is not permission. Preferences are application-owned and rechecked at delivery.

Tests use injected binding/SMTP facilities and actual file-backed SQLite through
the structural D1 interface, including connection restart, fencing, uncertainty,
known-rejection retry, delivery evidence, and inbox isolation. They send no external
emails and do not establish authenticated remote D1 or email service acceptance.
