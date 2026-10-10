# Notifications

Notifications compose typed templates, preferences, a store, jobs, and an optional mail provider. Import the portable API from `@cossackframework/core/notifications`. Application code supplies authentication, recipient resolution, and persistence. Core does not retain a Request or import the framework.

```ts
import { input } from '@cossackframework/core/input';
import {
  createNotificationRuntime, defineNotificationTemplate, notificationHtml,
} from '@cossackframework/core/notifications';

const welcome = defineNotificationTemplate({
  schema: input.object({ name: input.string({ required: true }) }),
  render: ({ name }) => ({
    subject: 'Welcome',
    text: `Hello ${name}`,
    html: notificationHtml`<p>Hello ${name}</p>`,
  }),
});

const notifications = createNotificationRuntime({
  namespace: 'application-notifications',
  templates: { welcome },
  store: notificationStore,
  email: { from: 'hello@example.com', provider: emailProvider },
  preferences: ({ recipient, template, channel }) =>
    preferenceStore.isEnabled(recipient.tenantId, recipient.userId, template, channel),
  dispatch: (id, recipient) => jobs.dispatch('notification', { id }, {
    scope: { tenantId: recipient.tenantId, actorId: recipient.userId },
    idempotencyKey: id,
  }),
});
```

Register a job with the shared schema `input.object({ id: input.string() })` and a handler that awaits `notifications.deliver(payload.id)`. Safe delivery retries throw the existing `TransientJobError`, so the jobs runtime schedules them. Configure job retry limits to allow at least the notification runtime's `maxAttempts` (default three). `leaseMs` defaults to 60 seconds; set it above the provider request timeout. Jobs and notification stores need compatible durable storage in production.

Enqueue from server application code:

```ts
await notifications.enqueue('welcome', { name: account.name }, {
  recipient: { tenantId: session.tenantId, userId: account.id, email: account.email },
  channel: 'email',
  idempotencyKey: `account-created:${account.id}`,
});
```

Each enqueue targets one channel: `email` or `in-app`. The logical identity includes namespace, template, channel, tenant, user, and the authored idempotency key. Repeating the same intent returns the existing record and may republish the same job safely. Changing its content under the same key is rejected; use a new intent key. If publishing fails, the queued record remains available: retry enqueue with the same key to recover publication. Without an idempotency key, each call creates a new intent.

Resolve recipient keys from authenticated server context. A client's claimed user or tenant ID is not authority. Do not expose `deliver`, inspection, or delivery-evidence APIs through unrestricted client methods. `list({ tenantId, userId })` returns only that recipient's delivered in-app records. `setRead(id, recipient, true)` marks read; `false` marks unread. A record owned by another user or tenant cannot be changed. Authenticate first, then pass the resolved recipient; do not accept a client-selected scope.

Preferences are checked at enqueue and again before delivery. Opt-out before enqueue returns `suppressed` without persistence or job publication. Opt-out while queued records a failed notification with `NOTIFICATION_PREFERENCE_DISABLED` and never invokes the provider. A preference lookup failure retries before sending, up to the configured limit. Opt-out cannot retract a provider's earlier acceptance; if a previous attempt is uncertain, the status remains `unknown`.

The `notificationHtml` tag escapes every interpolation, including `&`, `<`, `>`, quotes, and apostrophes. `escapeNotificationHtml(string)` also returns the branded `NotificationHtml` type. Literal markup and authored casts remain trusted application code. These helpers escape text; they do not validate URL schemes or make interpolation safe in script/style contexts. Template data must be bounded JSON-compatible values so stores can persist it consistently. Arrays must be plain and dense; accessors, custom properties, symbols, sparse slots, and hidden object fields are rejected without reading accessor values. Enumerable object fields whose value is `undefined` are intentionally omitted, matching JSON object serialization. Preview validates and renders the same typed template:

```ts
const preview = await notifications.preview('welcome', { name: '<Ada>' });
// preview.html contains &lt;Ada&gt;. No store, job, or provider write occurs.
```

Delivery states have distinct meanings:

| Status | Meaning |
| --- | --- |
| `queued` | Intent persisted; delivery pending or safely retryable. |
| `provider-accepted` | Provider explicitly accepted the message; inbox delivery is not proven. |
| `failed` | Known rejection, unavailable channel, or preference prevention. |
| `unknown` | Delivery might have occurred; no blind resend is allowed. |
| `delivered` | In-app publication committed, or authenticated provider evidence confirmed email delivery. |

`inspect(id)` returns only IDs, template/channel, status, attempts, timestamps, and fixed failure codes. It excludes recipient emails, message bodies, provider message IDs, and exception messages. Never print the private adapter record as a diagnostic.

Mail adapters implement `EmailDeliveryProvider`: `idempotency` is `provider` only if the provider actually enforces the supplied stable `idempotencyKey` across retries and restarts. Otherwise declare `none`. `send(message, context)` returns `{ status: 'provider-accepted', messageId? }`. It must not claim final delivery. An explicit rejection before provider acceptance may throw `new NotificationDeliveryError('rejected', { retryable: true })`. Ambiguous connection loss must throw `NotificationDeliveryError('unknown')` or an ordinary error; it must never be classified as known rejection just to retry it.

Before calling an external mail provider, the store persists a fenced sending marker. For non-idempotent SMTP or Cloudflare email, a crashed or expired sending claim becomes `unknown` instead of sending again. Explicit pre-accept rejection can reset retry eligibility when no earlier attempt is uncertain. A later rejection cannot disprove an earlier ambiguous acceptance: recovery preserves `unknown`, including after provider removal or a capability downgrade. An idempotent provider can safely retry uncertainty using the same key; its capability marker persists across restart, so replacing it with a non-idempotent provider cannot trigger a blind resend. Durable adapters must implement every store mutation atomically and respect claim tokens and lease expiry.

After verifying a genuine provider webhook or delivery receipt, call `recordDelivered(id, { messageId })`. It succeeds only for an email in `provider-accepted` with the same stored message ID. Client events or an application's desire to mark a message delivered are not evidence. An accepted message without a provider message ID remains accepted unless the provider supplies a supported correlation mechanism.

`MemoryNotificationStore` is an explicit process-only adapter for local tests and previews. Its snapshot/restore API simulates restart for deterministic tests; it is not durable infrastructure. Production applications must supply a durable store when using a durable job queue. Raw storage records contain private recipient/content data and must remain server-side. Database persistence is optional and lives outside core.
