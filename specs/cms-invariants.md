# CMS Invariants

The rules every CMS code path keeps. Each rule has one owner; other code calls the owner instead of repeating the check. Reviews and tests check against this list. Mapping of today's call sites: 2026-11-11.

## 1. Locked entries

An entry is **locked** when it has a password (`protected`) or is members-only.

| Who | Body and `password` |
| --- | --- |
| May update the entry (`canUpdate`) | Everything |
| Anyone else, including readers with `<resource>:read` | Neither: the entry's title, slug, dates and SEO fields only |
| Site visitor | The password form or the members gate; the body after unlocking or as a member |

**Owner:** the repository. `get`, `list`, `search`, revisions, and every event, outbox payload and hook argument built from a record return the **reader's view** unless the principal may update the entry. The app's `entryLock` stays the owner of the *site* gate (unlock cookie, member roles) and decides on top of the reader's view.

**Decisions:**
- One function (`lockedView(record, principal)`) builds the reader's view. `lockedRecord`, `lockedCopy`, `withheldFields` and the site-search `#visible` checks call it, and the separate copies of the test go.
- Outbox events (`resource.*`) carry the reader's view. Plugins and webhooks that need the full record read it with their own grant. Automations already run as their author, so they get the author's view.
- Theme bindings (`$.…`) and the `entry` given to themes and areas come from `entryLock`'s result, never from the raw record.
- Find-and-replace and the SEO tool count and show only entries the principal may update. `password` is never a replaceable field.
- An editor's own API responses (create, update, publish, restore) use the editor's principal.

## 2. Session assurance

**Owner:** `cmsPrincipal`. When General settings require two-step sign-in, a staff session whose sign-in used no second factor gets the anonymous principal everywhere except `/api/auth/*`. The rest of the API answers 403 `CMS_SECOND_FACTOR_REQUIRED`, and application passwords follow the account.

**Decisions:**
- Code decides with `c.get('principal')`, never with `c.get('user')` or the session. A signed-in check is `principal.kind === 'user'`.
- Known readers of `this.user` / `c.get('user')` to move to the principal: the site page's `viewOptions.user` (members-only entries), the `$user` binding and the site menus. Dashboard pages stay behind `authGuard` and `requireDashboardUser`. The security page and sign-out are the only exemptions.

## 3. Server methods

**Owner:** each `@Server` method re-reads what it acts on from route params or the database. Client `@State` is input, never proof.

**Decisions:**
- Route-scoped pages read `collection`/`id` from `c.req.param`, not from `this.route`/`this.id`. This covers the entry editor, the entries list, revisions and form submissions.
- Field definitions (`view`, `fieldGroups`, `taxonomy`) come from the host, not from state, before a value is checked or written.
- The access matrix test (`packages/cms/app/tests/access-matrix.test.ts`) lists every route and `@Server` method from the route manifest and calls each one as anonymous, subscriber, gated staff, editor and administrator. A new method fails the test until it has an expected row.

## 4. Writes and side effects

**Owner:** the write batch. A side effect that must follow a write is an outbox row in the same batch. Work done in-process after a commit must be safe to lose, or repeatable by the user's next action.

**Decisions:**
- Repeatable after a commit (keep in-process): cache-purge queueing, `ready()` reloads, child-session cleanup, last-used timestamps, draft timers.
- Move into the batch as outbox rows: the redirect writes after a collection or taxonomy rename, the `user.registered` / `user.signed-in` events, note mail and webhooks (`announceNote`), and the recovery audit and mail.
- Every write `kind` has a reconciler, even if it only drops the pending write.

## 5. Request budget

**Owner:** the RomeDB binding (`maxRequestBytes()`, `MAX_STATEMENTS`, and a new `maxResultBytes()`), which follows the limits the client reports (see `~/Sites/fastdb/requests.md`).

**Decisions:**
- No package hardcodes 32 statements, 48/60/64 KiB or 1 MiB: site import, settings, schema chunks, comments, redirects, taxonomies and forms batching read the binding's limits.
- Reads that can return whole documents in bulk read in pages that fit the result budget.
- A write too large for one request fails as `CMS_LIMIT` with a message, never as a raw RomeDB error.

## Testing

- **Access matrix** (rule 3), with a locked entry and a gated staff session among the fixtures (rules 1 and 2).
- **Live limits suite** against a local RomeDB: long rich text, eight translations, 40 collections, and concurrent saves of one entry (rules 4 and 5).
