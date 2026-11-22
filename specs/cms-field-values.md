# Field group values are document fields everywhere

Status: built 2026-11-21 for users and terms (Outcome below). RomeDB was probed first
(`specs/romedb-orm.md`, "Later, in the CMS only").

## Why

A field group attaches to collections, taxonomies, users and menus. Its values are stored in
two ways:

| Target | Storage today | What the database can do with a field |
| --- | --- | --- |
| A collection's entries | fields of the entry's document | index, filter, keep unique, follow a reference |
| Users, terms | JSON text in a `meta` column | nothing: every write replaces the whole value |
| Menu items | inside the menu's `items` JSON | nothing |

So `index`, `unique` and reference fields mean something on a collection and nothing on a
user or a term. "Which users use this file" is a `LIKE` over the JSON text. Two writes to a
user's meta at once (a profile save and `_recent_blocks`) can lose one.

## Decisions

- **A user and a term each get a document for their field values**, in a CMS-only document
  table, under the same ID as the relational row: `r__cms__user_fields:<user id>`, and
  `r__cms__tf_<taxonomy>:<term id>` (one table per taxonomy, because two taxonomies may give
  one field name different types). The relational row keeps what guards and sign-in read (email,
  status, roles, slug). A relational write cannot be guarded by a document's field (RomeDB
  request Q4), so nothing a guard reads moves.
- **The row and its document change in one write.** Creating, deleting and saving a profile
  put both in one batch.
- **One field is one write.** A save sets the fields that changed and unsets the ones that
  were cleared, in two statements of one write (Q3). System values such as `_recent_blocks`
  set their own field and no longer race a profile save. A cleared field is unset, never
  `null` (Q2).
- **Values are stored as an entry's are.** The store uses the repository's own encoding: a
  reference is a record link, a number is a float, rich text and rows are nested values.
  That encoding moves out of `repository.ts` into a function both use.
- **Indexes come from the schema planner.** The fields of the groups attached to users (and
  to each taxonomy) form an internal resource, so `index`, `unique` and search indexes are
  planned, applied and shown under Tools → Schema like a collection's. The entry repository
  is not used: these documents have no revisions, statuses, owners or webhooks.
- **Reads run side by side.** A user list reads rows and documents at once, as it reads
  roles. Terms read their documents after their rows, and only for a taxonomy that has fields.
- **`usingFile` filters on fields**, not on the JSON text: media fields are links, and lists
  of them use an array index.
- **Menu items stay inside their menu.** An item is not a row: the menu is one value, saved
  as a whole with a revision. Its items' fields keep today's behaviour.
- **No converter (alpha).** Host steps add the two document tables and drop the two `meta`
  columns. Field values that users and terms have today are not carried over.

## Order

1. Move the value encoding out of the repository; no behaviour change.
2. Users: the document table, the store, `CmsUsers` on it, the internal resource and its
   indexes, `usingFile`. Tests: a unique field across users, a filter by a field, a
   reference followed, two writers at once.
3. Terms, the same way.
4. Docs (`docs/cms`), and the limits' workarounds marked with their RomeDB request.

## Done when

- A field with `unique` on users refuses a second user with the same value.
- A user list can be filtered by an indexed field in the database.
- Saving a profile and writing `_recent_blocks` at once keeps both.
- The CMS unit suite and the CMS runtime suites pass on Node and Workers.

## Outcome

- `packages/cms/src/server/field-values.ts`: the value encoding (shared with the entry
  repository) and `FieldValues`, the store of one document per row.
- Internal resources (`internal: true`): `cms/user_fields`, and `cms/tf_<taxonomy>` while
  groups are attached to the taxonomy. The planner migrates them and Tools → Schema shows
  them. `cms.resources`, `status()`, the API and navigation leave them out. Collection names
  `user_fields` and `tf_*` are reserved.
- Host step 15 drops `cms_users.meta` and `cms_terms.meta`.
- A unique field's clash is a `CMS_CONFLICT` that names the field.
- A term's document writes carry a guard on the term's row, so a save that lost to another
  change writes no values. Deleting a taxonomy drops its table.
- Tests: two cases in `packages/cms/tests/field-groups.test.ts`.
- Workarounds that go with a RomeDB release: two statements for set and unset (Q3), unset
  in place of `null` (Q2), guards kept on relational rows (Q4).
- Not done: `usingFile` for terms (media in a term's fields is not counted as a use, as
  before); a taxonomy's leftover documents after its last group is detached stay until the
  taxonomy is deleted; a user's document writes carry no guard on the member row.

## Open

- Whether the dashboard's user list should offer filters by field once the database can
  answer them. Not part of this work.
