# CMS Invariants

The rules every CMS code path keeps. Each rule has one owner; other code calls the owner instead of repeating the check. Reviews and tests check against this list. Mapping of today's call sites: 2026-11-11.

## 1. Locked entries

An entry is **locked** when it has a password (`protected`) or is members-only.

| Who | Body and `password` |
| --- | --- |
| May update the entry (`canUpdate`) | Everything |
| Anyone else, including readers with `<resource>:read` | Neither: the entry's title, slug, dates and SEO fields only |
| Site visitor | The password form or the members gate; the body after unlocking or as a member |

**Owner:** `packages/cms/src/server/locked.ts` (`isLockedRecord`, `withheldFieldNames`, `lockedView`) and the repository's `readerView(record, principal)`. Everything that leaves for other readers carries the **reader's view** unless the principal may update the entry: revisions, events, outbox payloads, hook arguments, copies, search rows, API answers and dashboard tools. Plain `get` and `list` stay whole, because the site page needs the body for members and the password for the unlock check. The app's `entryLock` owns that *site* gate (unlock cookie, member roles), and nothing renders a raw record without it.

**Decisions:**
- `lockedView` is the only place the reader's view is built. `lockedCopy`, `withheldFields` and the site-search `#visible` checks call `isLockedRecord` / `withheldFieldNames`, and the separate copies of the test are gone.
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
- Joining a translation group is `translateEntry`'s alone (`JOIN_GROUP` in `repository.ts`): a save may keep or clear `translationGroup`, never name another entry's group. A shared-field save reaches only the members it checked, at most `SHARED_MEMBERS`.
- The access matrix test (`packages/cms/app/tests/access-matrix.test.ts`) lists every route and `@Server` method from the route manifest and calls each one as anonymous, subscriber, gated staff, editor and administrator. A new method fails the test until it has an expected row.

## 4. Writes and side effects

**Owner:** the write batch. A side effect that must follow a write is an outbox row in the same batch. Work done in-process after a commit must be safe to lose, or repeatable by the user's next action.

**Decisions:**
- Repeatable after a commit (keep in-process): cache-purge queueing, `ready()` reloads, child-session cleanup, last-used timestamps, draft timers.
- In the batch as outbox rows: redirects after a collection or taxonomy rename (`paths.moved`), the `user.signed-in` event (with the session write), and note mail and webhooks (`note.announced`).
- Exceptions, because the write spans the network and site databases: `user.registered` follows the account write and is deduplicated by its stable ID. The recovery audit row is written *before* the reset and fails closed (no audit, no reset link); its mail follows.
- Every write `kind` has a reconciler, even if it only drops the pending write; `tests/reconcilers.test.ts` scans the source for kinds without one.

## 5. Request budget

**Owner:** the RomeDB binding (`maxRequestBytes()`, `MAX_STATEMENTS`, and a new `maxResultBytes()`), which follows the limits the client reports (see `~/Sites/fastdb/requests.md`).

**Decisions:**
- No package hardcodes 32 statements, 48/60/64 KiB or 1 MiB: site import, settings, schema chunks, comments, redirects, taxonomies and forms batching read the binding's limits.
- Reads that can return whole documents in bulk read in pages that fit the result budget.
- A write too large for one request fails as `CMS_LIMIT` with a message, never as a raw RomeDB error.

## Testing

- **Access matrix** (rule 3), with a locked entry and a gated staff session among the fixtures (rules 1 and 2).
- **Live limits suite** against a local RomeDB: long rich text, eight translations, 40 collections, and concurrent saves of one entry (rules 4 and 5).
