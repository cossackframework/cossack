# Notes: review comments on an entry's fields, blocks and passages

Editors leave notes on an entry for each other, as in Google Docs comments and WordPress 6.9
Notes: on a passage of rich text, on a block, on a field, or on the entry. Notes live beside the
content in their own tables, never in the collection's records, travel live through the entry's
room (`specs/cms-collaboration.md`), and are resolved when the review is done. Built 2026-11-05
on `cms-foundation`; the guide is `docs/cms/notes.md`.

The user's decisions (2026-11-05): the name is **Notes** ("Comments" are the visitors');
notifications stay in the dashboard in v1 (no email); open notes are a **soft check**, with the
database and code ready for a hard check, delivered as the Writing setting `requireResolvedNotes`
(off by default); anyone who may edit the entry resolves, authors and administrators delete.

## Decisions

- **Storage.** Two host tables (schema step 21), nothing in the records. `cms_notes (id,
  resource, record_id, parent_id, user_id, target, text_range, quoted, body, status, resolved_by,
  resolved_at, created_at, updated_at)`, indexed on `(resource, record_id, status)` and `(user_id,
  created_at)`; a thread is a root (`parent_id` NULL, carrying `status` and the thread's last
  activity in `updated_at`) and its replies. `cms_note_mentions (note_id, thread_id, user_id,
  created_at, seen_at)`, indexed by user and by thread, is who a note names or replies to, and
  when they opened the entry. `CmsNotes` (`server/notes.ts`) keeps the rows; `notes.ts` holds the
  client-safe shapes, anchors, mentions and `checkNoteAction`. `cms.notes` on the host. Both
  tables are host tables (`HOST_TABLES`), so site exports and imports treat them as the host's,
  and they are not part of a site export. Limits: 4,000 characters a body, 200 a quote, 500 notes
  an entry, 20 mentions a note.
- **Anchors.** `target` is `entry`, `field:<anchor>`, `block:<field>:<blockId>` or
  `text:<richTextPath>`; a field anchor is a presence anchor without rows (`title`,
  `seo.description`), so the sidebar's rows take notes too. A text note stores `range` (ProseMirror
  positions when made or last moved) and `quote` (the words, ≤ 200 characters). **Live**, the
  `notesPlugin` (`collab/rich-text-notes.client.ts`) maps every placed note along each
  transaction; a note is placed once per editor mount (`anchorNote`: the range when it still holds
  the quote, else the nearest occurrence of the quote, else detached) and then follows the
  document, so typing inside a noted passage keeps the note on it. The tab that saves writes the
  moved ranges back (`note.move`, one call per save) so a reload finds them. A note whose words
  are gone is **detached**: the rail shows it on its block or field with "the text changed"; a
  removed block's notes are listed under "A removed block". Never a hard error.
- **Who.** The room's guard (`requireEntryEditor`) admits everyone who may edit the entry; they
  read, create, reply, resolve and reopen. Authors edit their own; authors and users with
  `cms:users` remove (a root takes its replies). The API checks the same with the entry's read
  access for GET and `canUpdate` for writes.
- **Live.** `EntryRoom.note(peer, action)` validates (`checkNoteAction`), writes through
  `cms.notes`, applies the change to the room's `notes` (loaded with the entry and read again on
  every `join`, so API writes show to whoever joins next) and broadcasts `('note', change)`:
  `created` (with the author as `Someone`), `edited`, `status`, `removed` (the IDs gone), `moved`.
  The snapshot carries `notes` and `people` (authors and peers by user ID), so a reconnect is
  consistent; the editor page loads the same at SSR for the first paint. The page applies its
  own changes from the method's answer and again, idempotently, from the broadcast.
- **Mentions.** A body is plain text with `@[Name](userId)` tokens (`mentionToken`,
  `mentionsIn`, `noteParts`); the composer's Combobox "Mention someone…" appends one. A note
  mentions the people in its body; a reply also mentions the thread's author and everyone who
  replied before, once per note per person, and never its own author. Rows are written on
  `create` and, for newcomers, on `edit`. "Notes for you" (`forUser`) are the open roots the
  person started or is mentioned in, by last activity; `unseen` counts their unseen mentions in
  open threads; `markSeen` runs when they open the entry. In the dashboard: the home card, a
  taskbar status ("Notes for you", `dashboardStatus`), and the entries list's amber count,
  which opens the editor with `?notes=open`. Email is a follow-up.
- **Editor UI.** The header's Notes button (count of open threads) toggles the rail
  (`notes-rail.ts`, a panel fixed at the right, not a modal Sheet: the entry stays editable
  while notes are read, and Escape inside it closes it): Open and Resolved tabs, the composer, and the threads
  with their anchor in words (`noteAnchor`: field label, sidebar label, block label and summary,
  or the quote), messages with avatars, reply, resolve or reopen, and the author's edit and
  remove as icon buttons with tooltips (`iconButton`; remove confirms in a Modal). Choosing a thread scrolls to its anchor on its tab and
  flashes it (`cms-note-flash`). Adding: `noteButton` beside every field label (`fieldRow`,
  `tracked`, the title), a block header's button (`BlockTree` `onNote`), and the rich text
  toolbar's *Note* (`RichTextField` `onNote`: the selection and its words; without a selection the
  block or the field). Markers: `noteMarker` counts on field labels (`fieldNoteCount`, passages
  and blocks count for their field) and block headers (`BlockTree` `notes`), amber underlines on
  passages (`RichTextField` `notes`, click opens the thread). The Checks panel lists open notes
  as a warning, or as what holds publishing when the setting is on.
- **Publishing.** `assertNotesResolved` (`content.ts`) refuses, with the Writing setting on, a
  save that takes an entry that is not live to `published` while it has open threads; an entry
  already live or scheduled keeps being updated. The setting is the prepared hard check; off,
  nothing is refused.
- **Maintenance.** `purgeOrphanNotes` checks a slice of the noted entries per run
  (`cms.notes.entries(limit, offset)`, a per-process cursor) and purges the notes of entries that
  no longer exist; a resource the host no longer declares keeps its notes.
- **Announcing (follow-ups built 2026-11-05).** `announceNote` (`notes-announce.ts`) runs after
  a note is created or a thread resolved, from the room and the API routes, without the caller
  waiting: `note.created` and `note.resolved` go to webhooks of the entry's collection
  (`WEBHOOK_EVENTS`, payload `note` plus `entry` `{ id, title, url }`, event IDs
  `note:<id>:created` and `note:<id>:resolved:<at>`); and, with the Writing setting
  `notesEmail` on (default) and `cms.mail` set (`createCMS({ mail })`, exposed with `mailFrom`
  on the host), the people a new note names (`cms.notes.mentioned`) get `noteMail` (plain text,
  mentions as `@Name`, the quote, a link to `?notes=open`). Plugin resources have no webhooks.
- **Live Edit.** The site draft (`SiteDraft`) carries `notes`, `people`, `me`, `admin` and
  `mentionable`; `SiteEditor` renders the same `notesRail` and `notesFor` marks in the body's
  and a block form's rich text editors, with a Notes button in its bar and markers and add
  buttons in the Blocks panel. The site has no room: writes go through the content API
  (`fetch`, same-origin) and the page keeps the notes through `onNotes`; moved ranges are not
  written back from the site.
- **Out of scope.** Push notifications; suggestions (tracked changes); notes on settings, forms,
  field groups and menus; exports; assignment.

## Delivery

| Where | What | Tests |
| --- | --- | --- |
| CMS package | `notes.ts` (with `noteMail`, `notePlainText`), `server/notes.ts` (with `mentioned`), host step 21 and `HOST_TABLES`, `cms.notes`, `cms.mail` and `cms.mailFrom`, the `writing.requireResolvedNotes` and `writing.notesEmail` settings, `WEBHOOK_EVENTS` `note.created` and `note.resolved`, exports | `notes-unit.test.ts`, live `notes.test.ts` |
| CMS app | `collab/room.ts` (`note`, `NoteChange`, snapshot `notes`/`people`), `collab/rich-text-notes.client.ts`, `rich-text.client.ts` and `rich-text-field.ts` (`notes`, `onNote`), `block-tree.ts` (`notes`, `onNote`, `onNotes`), `notes-rail.ts`, `notes-announce.ts`, the entry editor, the entries list, the dashboard home, `dashboard/access.ts`, `content.ts` (`assertNotesResolved`), `maintenance.ts`, `blocks.css`, the webhooks tool's labels, Live Edit (`site-editor.ts`, `site-editing.ts`, `site-editor.client.ts`, the site page) | `generated-runtime-cms-notes.test.js` (two Chromium users: a note on a selection seen live, a reply with a mention, the home card, webhook deliveries, resolve and reopen, typing before the passage, a save and a reload, the API, the publish gate, Live Edit) |
| API | `api/cms/content/[collection]/[entry]/notes.ts` (GET, POST), `api/cms/notes/[id].ts` (PATCH, DELETE) | the browser test |
| Docs | `docs/cms/notes.md`, the docs index, the co-editing guide's pointer, `README.md`, `agent-docs.json` | |
