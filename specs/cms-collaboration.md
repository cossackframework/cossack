# Co-editing: entries edited together through their room

Status: implemented on branch `cms-foundation`, 2026-11-05. The proposal and the review it
answers are in the gitignored `plan-cms-collaboration.md`. User guide: `docs/cms/collaboration.md`.

Several editors open one entry and edit it together, as in Google Docs: live text with
carets, every change visible to everyone, no lock. The entry's **room** is a realtime
component (`transport: 'durable-object'`), one live instance per entry of a site, a Durable
Object on Workers and in-process on Node. The room is the authority: it applies every change
in the order it receives them, broadcasts it, and keeps the shared draft between saves.

## Decisions

- **No CRDT.** The room's action queue orders every change, so three rules converge the
  editors (`packages/cms/src/collab.ts`, client-safe): scalars are last-write-wins per field
  with a client-side pending count (`PendingKeys`: a remote value of a field is ignored while
  the editor has a change of it in flight, since the room applied that change later); a blocks
  field takes ops by block ID (`treeOps` diffs two trees into inserts anchored on the sibling
  before, moves, removes and patches of one key; `applyTreeOp` applies one and drops what no
  longer applies; `treeHash` lets an editor notice a divergence and fetch the room's tree);
  rich text is `prosemirror-collab` with the room as the central authority (`StepLog` keeps a
  version and the last 500 steps per document, named by `richTextPath`: `body` or
  `content:b1.text`). Yjs was weighed and dropped: a binary document mirrored into the editor's
  values, base64 frames and a second persistence format, for offline merging a dashboard does
  not need.
- **The room is a child component beside the HTTP page.** `EntryRoom`
  (`src/cms/collab/room.ts`) is rendered by the entry editor at SSR, scoped to
  `site:<site>:<collection>:<entry>`, guarded by `requireEntryEditor` (a dashboard user who may
  update the entry; the check is kept five seconds per user and entry, since it runs again for
  every frame to every peer). The page keeps HTTP for saving, uploads and the media library.
  `/new` has no room: the first save navigates to the entry's address, which joins; the save's
  outcome travels as `?saved=` (`1`, `published`, `scheduled`, `pending`) for the message, and
  `settleUrl` drops it from the address once the navigation settled (the page stays mounted
  through it; `onMount` drops it after a full load). The page
  receives its `RoomHandle` after the first successful join, since a socket call before the
  connection opens rejects; a rich text field that cannot fetch the room's document runs alone
  and mounts again on the room's document when the room comes up.
- **Protocol.** `join` answers the draft (values, rich text versions, tree hashes, revision,
  peers); `set` a scalar; `tree` one op, answered with the tree's hash; `blocks` a field's
  tree; `steps` a batch against a version (`accepted`, `behind` with the steps the editor
  lacked, or `reload`); `richText` a document to start over from; `presence` a tab's layout
  tab, field, block, selection and drag; `leave`; `saved` after the page's save; `reload` after
  a change outside the room; `draft` before a save, so the save holds everyone's words.
  Broadcasts: `set`, `tree`, `steps`, `presence`, `left`, `saved`, `reloaded`. Public `@State`:
  `rev`, `dirty`, `diverged`, `oversized`, `participants`; the draft itself travels as events.
- **The shared draft** (`cms_drafts`, `CmsDrafts`): one row per entry with the values, the
  rich text versions, the editors present and their time, written a second after the last
  change and at least every five seconds, loaded on the room's first join when newer than the
  record and from the same revision. A RomeDB request takes 64 KiB, so the row is capped at 48
  KB of values (`DRAFT_MAX_BYTES`); past that the room keeps the draft in memory and
  `oversized` warns. `editing()` names who is in the room for the entries list (`editors()`,
  90-second window). For saved entries the per-user autosave, its restore offer and the
  session-storage reload restore are off; `/new` keeps them. Maintenance purges rows untouched
  for a month.
- **Rich text.** `rich-text-schema.ts` builds the TipTap schema once for the editor and the
  room (`getSchema`); the room applies `Step.fromJSON` to its document and refuses a batch
  whose result fails `richTextProblem`. The client (`collab/rich-text-collab.client.ts`) sends
  one batch at a time, confirms on the reply or the broadcast (whichever comes first), rebases
  on `behind`, fills a gap by asking for the steps after its version, and reloads the document
  on `reload`, dropping unconfirmed steps. Other editors' carets and selections are
  decorations mapped along the document. `RichTextField` takes a `collab` prop; the document
  comes from the room before the editor mounts, and the editor mounts again when the room comes
  up after it. A block's rich text edited in the side panel and the items of a multiple rich
  text field are not co-edited: the panel's edits reach the document as steps when it closes,
  and a multiple field travels as one value. The side panel of a tree block follows the room
  (`followDialog`): a remote patch of a key replaces that key alone, so what the tab types in
  the panel's other fields stays; a replaced tree brings the whole block; a removed block closes
  the panel. The tree's summary prefers the block type's `body` field, since a patch reorders
  the data's keys.
- **Presence.** Every peer is a browser tab; `groupPeers` groups them by user with the layout
  tabs open. The header shows everyone in the entry, the viewer first and named "(you)"
  (`avatarStack` at 16 px, color rings by `participantColor`, up to five then "+N"); each
  layout tab's label shows the editors on it;
  a field or block another editor is in is outlined in their color with a chip (`presenceChip`),
  as is a dragged block (`BlockTree` `editing` and `onDrag`); carets carry names. Every synced
  control is a presence anchor (`data-field`, compared as a string): the resource's fields
  (`fieldRow`), group fields through `FieldGroupView` `presence` (a repeater's row fields as
  `items:<rowId>.<name>`), the sidebar's rows by their key (`status`, `publishedAt`, `parent`,
  `menuOrder`, `template`, `authors`, `commentsOpen`, a taxonomy's box by its name) and the
  search box's keys (`seo.description`), the last two through the page's `tracked`. Focus in a
  block's side panel (`data-block-sheet`) counts as focus in the block, and the panel shows who
  else is in it; without a picture an avatar shows the editor's initials on their color. A
  tab's own user is left out of outlines, carets and stacks. Peers time out after 30 seconds
  (`PRESENCE_TIMEOUT`): the room drops them and broadcasts `left`, and each tab also forgets
  the peers it has not heard from for as long by its own clock (`expiredPeers`), since a
  restarted instance sends no `left`. Tabs send presence every 15 seconds and `leave` on
  `pagehide`; a heartbeat from a tab the room no longer knows (throttled in the background, or
  after a restart) re-creates the peer with the user's name and picture, as `join` does. The entries list shows who is in each
  entry's room from the draft rows (`cms.drafts.editors`, a 90-second window).
- **Saving and divergence.** Any participant saves; before saving the page takes the room's
  draft for fields it has no change in flight for; after saving it calls `saved`, which reads
  the record again, refreshes everyone (rich text documents the record holds differently
  restart their logs) and broadcasts who saved. `join` and `saved` compare the record's
  revision with the draft's base: a record written elsewhere sets `diverged`, and the editor
  offers *Reload the draft from the entry*. While connected, leaving the editor asks nothing.
  The `saved` broadcast names the saving tab, which keeps its own "Saved." notice while the
  others read who saved. The renderer assigns a child's props onto its instance, so the room's
  event handlers are named `receive*`: a handler named like a prop (`onSaved`) is shadowed by
  the page's callback, which the event dispatch then calls with the event's payload.
- **Framework.** Generated Workers configs bind `COSSACK_OBJECT` → `AppDurableObject`
  (migration `realtime-v1`), which every realtime page needs and which they lacked.
  `prosemirror-collab` joins the CMS editor's packages. Not built: a per-peer authorization
  freshness window in the framework (the guard's own cache covers the room), a peer-closed
  lifecycle hook (presence relies on `leave` and the timeout), Live Edit on the site, read-only
  observers.

## Delivery

| Area | What changed | Tests |
| --- | --- | --- |
| CMS package | `collab.ts` (rules, presence, step log), `server/drafts.ts` (`CmsDrafts`, `DRAFT_MAX_BYTES`, `EDITING_WINDOW`), host step 20 (`cms_drafts`), `cms.drafts`, exports | `collab-unit.test.ts`, live `collab.test.ts` |
| CMS app | `collab/room.ts` (`EntryRoom`, `RoomHandle`, `entryScope`, `requireEntryEditor`), `collab/rich-text-collab.client.ts` (`CollabSession`, carets), `collab/presence.ts`, `rich-text-schema.ts`; `rich-text.client.ts` and `RichTextField` on the shared schema with `collab`; the entry editor shares, applies and shows; `BlockTree` `editing` and `onDrag`; maintenance purges drafts | `rich-text-field.test.ts` |
| Scaffold and CLI | `COSSACK_OBJECT` binding and migration; `prosemirror-collab` in `TIPTAP_PACKAGES`, `dependencyVersions` and the client pre-bundle list; the test fixture's editor packages | `generated-runtime-cms-collab.test.js` (two Chromium users: title, merged text, presence chip, caret, save, reload to the draft) |
| Docs | `docs/cms/collaboration.md`, index and README | |
