---
title: 'Co-editing'
description: 'Several people edit one entry together: live text, presence and a shared draft through the entry’s room.'
---

# Co-editing

Open a saved entry in the dashboard and everyone else who has it open edits it with you. Text
you type appears for them as you type it, their carets and selections show in your rich text,
the title and every other field follow the last change made, and blocks moved or added by one
editor move for all. There is no lock on an entry: the entry's **room** carries every change to
every editor, and the room's draft is what gets saved.

Co-editing runs on Cossack's realtime transport: on Cloudflare the room is a Durable Object,
on Node it lives in the server process. A generated application has what it needs; nothing is
configured.

## What you see

- **Who is here.** Small avatars of everyone in the entry sit in the editor's header, you
  first, ringed in each one's color; without a picture an avatar shows the person's initials. A layout tab shows the avatars of the editors on it, so a crowded entry
  reads at a glance. Hovering a stack names everyone. A tab that falls silent, through a closed
  laptop or a lost connection, is gone from the stacks and chips within half a minute.
- **Notes.** Review notes on a passage, a block or a field travel through the same room, so
  a note left by one editor shows for everyone at once; see [Notes](/docs/cms/notes.md).
- **Where they are.** A field or block another editor is in is outlined in their color with a
  chip naming them: the title, a field in a group, a sidebar setting such as the status or a
  term, or a row of the search and sharing box; a block someone is dragging is outlined too.
  In rich text, their caret carries their name and their selection is tinted.
- **Saving.** Anyone may save or publish. The save takes the room's draft, so it holds what
  everyone wrote, and the others see "*Name* saved this entry." The entry's revisions record
  the saver. While the room is connected, leaving the editor asks nothing: unsaved work stays
  in the shared draft and is there when the entry is opened again.
- **Reconnecting.** A tab that loses its connection shows *Reconnecting…* and joins the room
  again when it is back, taking the room's draft; what it typed meanwhile is lost.
- **Changed outside the editor.** When the entry was written by something other than the
  room (the content API, an import, a plugin), the editor says so and offers *Reload the draft
  from the entry*, which starts everyone over from the saved entry.
- **A new entry** has no room until its first save, which opens the editor at the entry's own
  address, where its room is.

## How changes merge

The room applies changes in the order it receives them, and three rules keep every editor on
the room's values:

| Content | Rule |
| --- | --- |
| Title, slug, status, dates, choices, terms, field groups | Last change wins, per field. An editor's own change applies at once; a remote value of a field is ignored while the editor still has a change of that field on its way, because the room applied that change later. Presence shows who is in a field, so two people typing the same title at once is visible and rare. |
| Blocks | Changes travel by block ID: insert after a sibling, move, remove, patch one key. Two editors working in different blocks never disturb each other; a move keeps the other editor's edits to the moved block. The room drops an op on a block that is gone and answers each op with a hash of its tree; an editor whose tree differs asks for the room's. A block's settings typed in the side panel travel the same way, and an open panel follows the room: a key another editor changes updates in it, a block they remove closes it. |
| Rich text | `prosemirror-collab`, with the room as the central authority: each document has a version and a log of recent steps; a batch made against an old version comes back with the steps the editor lacked, which rebase its own. Text typed by two people in one paragraph merges by character. |

Rich text fields of the entry and the text of `core/richtext` blocks are edited this way. Rich
text of a block edited in the side panel reaches the document when the panel closes, and the
items of a multiple rich text field travel as one value.

## The shared draft

The room writes its draft to the site's database a second after the last change (and at
least every five seconds while changes keep coming), one row per entry in `cms_drafts`, with
the rich text versions and the editors present. An instance that restarts, or a room that
empties and reopens, starts from that draft when it is newer than the saved entry. The row is
capped at what an entry can hold and still be saved (`saveBytes`): a save carries the fields as
the RomeDB client types them (rich text and blocks weigh about three times their JSON), and
the JSON again in the search text, the revision and the event. That is about 9–14 KB of values
on a local RomeDB service (64 KiB requests), depending on how much formatting the text has, and
about 16 times that on RomeDB Cloud (1 MiB requests). A draft past that stays in memory alone,
the editor warns, and a save of that size is refused as too large.

The per-user autosave still serves new entries, which have no room yet. For saved entries the
shared draft replaces it, and the old autosave restore offer is gone.

The entries list reads the draft rows to show who is editing an entry right now.

## Who may join

Joining a room needs a signed-in dashboard user allowed to update the entry; the check runs
for the connection, for every change and for every frame delivered, and is kept for five
seconds per user and entry so it does not read the record on every keystroke. Application
passwords never join. Read-only observers are not supported.

## In code

`@cossackframework/cms` exports the rules as plain functions, so an application or a plugin
can build another co-edited screen on them:

- `PendingKeys`, `scalarKey`, `patchKey`: the pending-key rule for last-write-wins values.
- `treeOps(field, before, after, { skip })`, `applyTreeOp(blocks, op)`, `treeHash(blocks)`:
  ops by block ID between two trees, their application, and the hash the room answers with.
- `StepLog`: the version and bounded step log of one rich text document; `richTextPath`
  names a document (`body`, or `content:b1.text` for a block's key).
- `participantColor`, `groupPeers`, `livePeers`, `checkPresence`: colors by user, the room's
  users from its tabs, the presence timeout, and presence from client input.

The room itself is `EntryRoom` in `src/cms/collab/room.ts` of the application, a realtime
component scoped to `site:<site>:<collection>:<entry>`; the editor page talks to it through a
`RoomHandle`. `cms.drafts` (`CmsDrafts`) is the draft store.
