---
title: 'CMS Hooks'
description: 'The CMS extension points, how handlers run, and how a plugin defines points of its own.'
---

# CMS Hooks

Hooks are named, versioned extension points. An **action** notifies handlers of
something that happened; a **filter** passes a value through handlers that each return
the next value. The CMS defines its points in `@cossackframework/cms`; plugins register
handlers in `server.ts` and may define points for other plugins.

The registry comes from `@cossackframework/core/hooks` and is local and explicit: no
global state, no discovery, no RPC.

## Registering a handler

```ts
import { afterCommit, beforeWrite } from '@cossackframework/cms';
import type { PluginContext } from '@cossackframework/cms/server';

export function register(context: PluginContext) {
  context.hooks.addFilter(beforeWrite, (draft, { input }) => {
    if (input.resource !== 'support-desk/tickets') return draft;
    if (typeof draft.subject !== 'string' || !draft.subject.trim()) throw new Error('A ticket needs a subject.');
    return { ...draft, subject: draft.subject.trim() };
  }, { priority: 5 });

  context.hooks.addAction(afterCommit, async (event, { signal }) => {
    if (event.resource !== 'support-desk/tickets' || event.topic !== 'resource.created') return;
    await context.fetch('https://api.example.com/tickets', { method: 'POST', body: JSON.stringify(event.record), signal });
  });
}
```

Both points must be listed in the manifest's `hooks` with their version, and the
administrator grants `hook:<point>` for each. A handler for an undeclared point fails
the policy lint and `register()`.

Every handler receives a context: `point`, `version`, `plugin`, a `signal` that aborts
when the caller cancels or the deadline passes, and the `deadline` in Unix milliseconds. A
filter's context also carries `input`, frozen data about the call.

### How handlers run

- Order is deterministic: `priority` (lower first, default 10), then plugin name, then
  registration order.
- Payloads and inputs are frozen copies. A filter returns its next value; it never
  mutates the one it got.
- Each handler runs under the point's deadline (`timeoutMs`). A handler that runs out of
  time, throws or is cancelled produces a `HookError` with `COSSACK_HOOK_TIMEOUT`,
  `COSSACK_HOOK_FAILED` or `COSSACK_HOOK_CANCELLED`.
- A filter stops at the first error, and the caller gets it: throwing in a `before-*`
  filter rejects the write with a validation error.
- An action runs every handler and reports each outcome. The caller gets an
  `ActionReport` with `ok`, the `outcomes` by plugin and the `failed` plugins. The outbox
  uses `failed` to retry only those.
- Handlers of an inactive plugin (invalid manifest, unmigrated resources or missing
  grants) do nothing: a filter returns its value unchanged and an action returns at once.

## Extension points

All points are version 1. `before-*` filters run inside the request, before the batch is
prepared, under short deadlines and with no external effects; actions marked "outbox"
run after commit from the outbox and can be delivered more than once, so use the
`eventId` as an idempotency key.

### Resources

| Point | Kind | Deadline | Value and input |
| --- | --- | --- | --- |
| `cms.resource.before-write` (`beforeWrite`) | filter | 2 s | Value: the `Draft` of field values about to be written. Input: `resource`, `action` (`create`, `update`), `id` (null on create), `previous` record, `actor`. Throw to reject. |
| `cms.resource.after-commit` (`afterCommit`) | action, outbox | 10 s | `ResourceEvent`: `eventId`, `topic` (`resource.created`, `resource.updated`, `resource.deleted`), `resource`, `id`, `revision`, `actor`, `at`, the public `record` after the write (null after delete), `previousStatus`. |
| `cms.payment.event` (`paymentEvent`) | action, outbox | 15 s | `PaymentEvent`: `eventId`, `provider`, `type` (`checkout.completed`, `payment.succeeded`, `payment.failed`, `subscription.updated`, `subscription.cancelled`, `refund`), `providerType`, `checkoutId`, `reference`, `customerEmail`, `amount`, `currency`, `metadata`, the provider's `object`. From the provider's webhook at `POST /api/cms/payments/webhook`, verified by the provider. |
| `cms.cache.purge` (`cachePurge`) | action, outbox | 15 s | `CachePurgeEvent`: `eventId`, `topic: 'cache.purge'`, `at`, `site`, `reason`, the `tags` and absolute `urls` of the pages a change touched (the site's tag alone means every page). Handlers purge a cache; throw to retry. See [Cache](/docs/cms/cache.md). |

`actor` everywhere is a `WriteActor`: `{ kind: 'user' | 'system' | 'anonymous', id }`.

### Forms

| Point | Kind | Deadline | Value and input |
| --- | --- | --- | --- |
| `cms.form.prefill` (`formPrefill`) | filter | 1 s | Value: the `FormValues` a form starts with. Input: `form`, `actor`, `query` (the page address's parameters). |
| `cms.form.validate` (`formValidate`) | filter | 2 s | Value: `FormErrors`, messages by input name, `_form` for the whole submission; return them with yours added. Input: `form`, `actor`, `values`, `ip`, `userAgent`, `page`. |
| `cms.form.before-submit` (`formBeforeSubmit`) | filter | 2 s | Value: the valid `FormValues` about to be stored; they are checked again after. Input: the submission context. |
| `cms.form.confirmation` (`formConfirmation`) | filter | 2 s | Value: `{ kind: 'message', message }` (Markdown) or `{ kind: 'redirect', url }`. Input: `form`, `submission`. |
| `cms.form.notification` (`formNotification`) | filter | 2 s | Value: the `FormEmail` (`to`, `subject`, `text`, `replyTo`) about to go out, or null to not send it. Input: `form`, `submission`, `rule`. |
| `cms.form.submitted` (`formSubmitted`) | action, outbox | 10 s | `FormSubmittedEvent`: `eventId`, `topic: 'form.submitted'`, `form`, `submission`, `actor`, `at`, `stored` (false when the form keeps no submissions), `origin`. |

`form` is a `FormRef`: `id`, `slug`, `title` and its `inputs`, a repeater among them
carrying its rows' inputs as `inputs`. A repeater's value in `FormValues` is a list of
rows, each `{ _id, ...values }`; its errors are keyed `repeater.<row id>.<input>`. An
input with `multiple` on holds a list of its kind's values (strings, or numbers for a
Number input); its item errors are keyed `<input>.<position>`.

A file input (`form/file`, kind `file`) holds a list of `FormFile`s: `{ id, name, size, type }`,
metadata only. Hooks see the posted files' `name`, `size` and `type` (no `id` yet, no bytes)
and cannot replace them; the stored submission, `cms.form.submitted`, emails (`{all_fields}`
lists names and sizes), CSV exports and `form.submitted` webhooks carry the same metadata with
each file's `id`. The bytes are private: only `GET /api/cms/forms/<form>/submissions/<id>/files/<file>`
serves them, to those with `cms:submissions`.

### Terms, comments and menus

| Point | Kind | Deadline | Value and input |
| --- | --- | --- | --- |
| `cms.term.before-save` (`termBeforeSave`) | filter | 2 s | Value: `TermDraft` (`name`, `slug`, `description`, `parent`, `icon`, `meta`). Input: `taxonomy`, `action`, `id`, `previous`, `actor`. Throw to reject. |
| `cms.comment.before-save` (`commentBeforeSave`) | filter | 3 s | Value: `CommentDraft` (`content`, `authorName`, `authorEmail`, `authorUrl`, `status`). Return it with `status: 'spam'` to hold it; throw to refuse it. Input: `collection`, `entry`, `parent`, `actor`, `ip`, `userAgent`. |
| `cms.menu.before-save` (`menuBeforeSave`) | filter | 2 s | Value: the menu's items. Input: `id`, `name`, `actor`. Checked again after. |

### Dashboard lists

| Point | Kind | Deadline | Value and input |
| --- | --- | --- | --- |
| `cms.dashboard.entry-actions` (`entryActions`) | filter | 1 s | Value: the quick actions under one entry in a list, the built-in ones included. Add, remove or reorder them. Input: `resource`, `actor`, `record`. |
| `cms.dashboard.entry-columns` (`entryColumns`) | filter | 2 s | Value: `EntryColumn[]` (`id`, `label`, `values` by record ID) after the built-in columns. Input: `resource`, `actor`, `records`. |
| `cms.dashboard.bulk-actions` (`bulkActions`) | filter | 1 s | Value: the `EntryAction[]` offered for the selected entries. Input: `resource`, `actor`. |

An `EntryAction` is one of:

- `{ label, href }`: a link.
- `{ label, command: { plugin, name }, confirm? }`: runs a plugin command with
  `{ resource, id }` or `{ resource, ids }` as its input. `confirm` asks first.
- `{ id, label }` with `id` in `ENTRY_ACTION_IDS`: a built-in action that the list runs itself.

Every action may also have:

- `id`: a name, so that other plugins can find the action.
- `danger`: shows the action in the destructive color.

Quick actions show as text links under the entry's title, separated by bars. Bulk
actions show as menu entries.

### Quick actions

The value of `cms.dashboard.entry-actions` starts with the list's own actions. Each has an
`id` from `ENTRY_ACTION_IDS`:

| `id` | Shown | Does |
| --- | --- | --- |
| `edit` | Always, except in the trash | Links to the entry editor. |
| `duplicate` | When you may create entries | Copies the entry as a draft. |
| `trash` | Publishable collections | Moves the entry to the trash. |
| `delete` | Other resources | Deletes the entry, after a confirmation. |
| `view` | When the entry has a public page | Links to the page. |
| `restore` | In the trash | Restores the entry as a draft. |
| `delete-permanently` | In the trash | Deletes the entry, after a confirmation. |

Return a new list to change the actions. To add an action, append it. To remove one, filter
it out by `id`. To move one, change its place in the list:

```ts
import { entryActions } from '@cossackframework/cms';

export function register(context: PluginContext) {
  context.hooks.addFilter(entryActions, (actions, { input: { resource, record } }) => {
    if (resource !== 'cms/posts') return actions;
    const kept = actions.filter(action => action.id !== 'duplicate');
    const view = kept.find(action => action.id === 'view');
    return [
      ...(view ? [view] : []),
      ...kept.filter(action => action !== view),
      { id: 'support-desk.ticket', label: 'Open a ticket', href: `/dashboard/support-desk/new?entry=${record.id}` },
    ];
  });
}
```


When a handler fails, the list keeps the built-in actions. A command action runs only if
the plugins return it again when the list runs it. A client cannot name a command of its
own.

### Dashboard notices and taskbar

| Point | Kind | Deadline | Value and input |
| --- | --- | --- | --- |
| `cms.dashboard.notices` (`dashboardNotices`) | filter | 1 s | Value: the `DashboardNotice[]` shown above every dashboard screen, empty to start. Input: `actor`. |
| `cms.dashboard.taskbar` (`dashboardTaskbar`) | filter | 1 s | Value: the `TaskbarItem[]` along the dashboard's bottom bar, the built-in ones included (comments to moderate, pending review, plugins waiting for a grant). Input: `actor`. |

A `DashboardNotice` is `{ id, tone, message, href? }`: `tone` is `info`, `success`, `warning`
or `error`, `message` is plain text up to 300 characters and `href` a same-site path the
notice links to. A `TaskbarItem` is `{ id, label, href, count?, tone? }`. The dashboard keeps
ten notices and twenty items and drops any that are malformed. Both run on every dashboard
navigation, so keep handlers fast and cache what they count:

```ts
import { dashboardNotices, dashboardTaskbar } from '@cossackframework/cms';

export function register(context: PluginContext) {
  context.hooks.addFilter(dashboardNotices, async notices => context.settings.get('apiKey')
    ? notices
    : [...notices, { id: 'shop.key', tone: 'warning' as const, message: 'Add your API key to start taking orders.', href: '/dashboard/settings#plugin:shop' }]);
  context.hooks.addFilter(dashboardTaskbar, async (items, { input: { actor } }) => {
    const waiting = await context.cache.remember('waiting', 60_000, () => countWaiting(actor));
    return waiting ? [...items, { id: 'shop.orders', label: 'Orders to ship', href: '/dashboard/shop', count: waiting, tone: 'warning' }] : items;
  });
}
```

Unlike `ui.ts` slots, these points reach an [isolated](/docs/cms/plugins.md#where-server-code-runs)
plugin too, since it registers them in `server.ts`.

### The site

| Point | Kind | Deadline | Value and input |
| --- | --- | --- | --- |
| `cms.site.entry-view` (`siteEntryView`) | filter | 1 s | Value: `{ title, excerpt, before, after }` of an entry's full view on the site, after it is rendered and before the theme draws it, as WordPress's `the_title` and `the_content`. `before` and `after` are blocks in the stored shape (`{ _id, type, data }`), rendered around the content as the entry's own are. Input: `collection`, `id`, `url`, the `record` without its password, `signedIn`. The host keeps at most ten valid blocks each side of known types and refuses `core/html` anywhere in them, so no filter, an isolated plugin's included, puts markup or script of its own on the site. Not run for a locked entry. |
| `cms.site.markdown` (`siteMarkdown`) | filter | 1 s | Value: an entry as machines read it (`Accept: text/markdown` or `?format=md`), the Markdown document with its front matter. Input: `collection`, `id`, the absolute `url`, the `record` without its password. Return it with your text added, such as a licence or a source note; a failing handler leaves it as it was. |

A theme or an in-app plugin changes what visitors see with templates, blocks and the `ui.ts`
`head` export; see [Plugins](/docs/cms/plugins.md#uits).

### Mail

| Point | Kind | Deadline | Value and input |
| --- | --- | --- | --- |
| `cms.mail.before-send` (`mailBeforeSend`) | filter | 2 s | Value: the `MailMessage` about to go out (`to`, `from`, `subject`, `text`, `html`, `replyTo?`), or null once a filter cancelled it. Input: `kind`, `plugin` (the sender of `kind: 'plugin'` mail, else null), `site`. Return it changed, or null to not send it. |

Every email the site sends goes through `host.mail`: the sign-up confirmation (`verification`),
password resets (`reset`), sign-in links (`magic-link`), invitations (`invitation`), comment
notifications (`comment`), note emails (`note`), automations (`automation`), form notifications
(`form`) and plugin mail through `context.mail` (`plugin`); mail application code sends without
a `kind` is `other`. The filter runs after the layout, so `html` is the finished document
(Settings → Email: site title and logo, the message, a footer) and a filter may replace it.

- `from` is always the site's sender. For `verification`, `reset`, `magic-link`, `invitation`
  and `other`, `to` and `replyTo` stay what the CMS chose whatever the filter returns; for the
  other kinds they may change to one valid address each.
- The subject becomes one line of at most 300 characters. A `text` over 100,000 characters or
  an `html` over 300,000 (`MAIL_LIMITS`), or one that is empty, keeps the original.
- A filter that throws or runs past its deadline does not stop the mail: it goes out as the
  layout made it, without any filter's change.
- The value carries sign-in and reset links. Grant `hook:cms.mail.before-send` only to a
  plugin you would trust with them.

```ts
import { mailBeforeSend } from '@cossackframework/cms';

export function register(context: PluginContext) {
  context.hooks.addFilter(mailBeforeSend, (message, { input: { kind, plugin } }) => {
    if (!message) return message;
    // The newsletter plugin's mail goes out through its own service.
    if (kind === 'plugin' && plugin === 'newsletter') return null;
    // Form notifications go to the help desk instead.
    if (kind === 'form') return { ...message, to: 'desk@example.com', subject: `[Web form] ${message.subject}` };
    // A reset keeps its recipient; the subject may change.
    if (kind === 'reset') return { ...message, subject: `Acme: ${message.subject}` };
    return message;
  });
}
```

### Users

| Point | Kind | Deadline | Value and input |
| --- | --- | --- | --- |
| `cms.user.before-register` (`userBeforeRegister`) | filter | 2 s | Value: `{ email, name, roles, approval, refused }` before a visitor's account is made. Set `refused` to a message to refuse it (an email domain allowlist), change `name` and `roles` (role IDs; unknown ones are dropped), or set `approval` to hold the account for an administrator. The email cannot change. Input: `origin`. |
| `cms.user.registered` (`userRegistered`) | action, outbox | 10 s | `{ eventId, topic, at, user: { id, email, name }, state }` after a visitor registered; `state` is `active`, `verification` (waits for the email link) or `approval`. Deliveries can repeat: use `eventId`. |
| `cms.user.signed-in` (`userSignedIn`) | action, outbox | 10 s | `{ eventId, topic, at, user }` after a session started, by any sign-in method or the automatic sign-in after registering or confirming the email. |

```ts
import { userBeforeRegister, userRegistered } from '@cossackframework/cms';
import type { PluginContext } from '@cossackframework/cms/server';

export function register({ hooks }: PluginContext) {
    hooks.addFilter(userBeforeRegister, draft => draft.email.endsWith('@example.com')
        ? draft
        : { ...draft, refused: 'Register with your example.com address.' }, { plugin: 'allowlist' });
    hooks.addAction(userRegistered, async ({ user, state }) => {
        if (state === 'active') await welcome(user.email);
    }, { plugin: 'allowlist' });
}
```

## Points a plugin provides

A plugin can define extension points of its own, so other plugins extend it the way they
extend the CMS. The provider declares them in its manifest:

```json
"provides": [
  { "point": "shop.order-placed", "kind": "action", "version": 1 },
  { "point": "shop.price", "kind": "filter", "version": 1 }
]
```

and invokes them from its code. A point is looked up by name and cast to the payload
types the provider documents:

```ts
export function register(context: PluginContext) {
  const placed = context.hooks.point<{ total: number }>('shop.order-placed', 'action');
  const price = context.hooks.point<number, { sku: string }>('shop.price', 'filter');

  context.commands.add('order', async input => {
    const total = await context.hooks.applyFilters(price, Number(input.price), { sku: 'mug' });
    const report = await context.hooks.doAction(placed, { total });
    return { total, handlers: report.outcomes.map(outcome => `${outcome.plugin}:${outcome.status}`) };
  });
}
```

A consumer lists the points in its manifest's `hooks` with the provider's version and
registers handlers the same way as for a CMS point:

```json
"hooks": [{ "point": "shop.order-placed", "version": 1 }, { "point": "shop.price", "version": 1 }]
```

```ts
export function register(context: PluginContext) {
  context.hooks.addFilter(context.hooks.point<number, { sku: string }>('shop.price', 'filter'), value => value * 0.9);
  context.hooks.addAction(context.hooks.point<{ total: number }>('shop.order-placed', 'action'), payload => { /* ... */ });
}
```

Rules:

- The host builds every point from the manifests before any plugin's `register()` runs,
  so the order plugins are installed in never matters.
- A consumer of a point no installed plugin provides, or of another version, is an
  invalid plugin and stays inactive with that reason.
- `hooks.point()` throws for a point the manifest lists in neither `hooks` nor `provides`,
  and for the wrong kind. `doAction` and `applyFilters` throw for a point the plugin does
  not provide.
- Nothing runs while the provider is inactive: `doAction` reports no outcomes and
  `applyFilters` returns the value. Handlers of an inactive consumer are registered but do
  nothing, so the provider's report still lists them as `ok`.
- Payload types are not checked at runtime. Bump the point's `version` when the payload or
  the filtered value changes incompatibly; consumers written against the old version
  become invalid instead of failing quietly.

## Built-in modules

The CMS's own modules (content, forms) register handlers through a `ModuleContext` before
any plugin, with the same registry. Application code that builds a host with `createCMS()`
can also pass `modules` of its own: `{ owner, resources, collections?, taxonomies?,
blocks?, settings?, register? }`. Modules are trusted code and are not subject to grants
or the policy lints; plugins are the unit of third-party extension.
