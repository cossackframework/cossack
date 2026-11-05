---
title: 'Notes'
description: 'Review notes editors leave for each other on an entry, a field, a block or a passage of text, resolved when the review is done.'
---

# Notes

Notes are the comments editors leave for each other while an entry is written: on a passage
of text, on a block, on a field, or on the entry as a whole. They are for the people editing,
as comments in Google Docs or Notes in WordPress 6.9; the visitors' comments under a
published entry are a different thing, under Discussion. Notes live in their own tables
beside the content, so nothing of them ends up in the entry's records, its revisions or its
exports. While the entry is open in its room (see [Co-editing](/docs/cms/collaboration.md)),
notes travel live: a note left by one editor shows for everyone at once.

## Leaving a note

- **On text.** Select a passage in a rich text block or field and choose *Note* in the
  toolbar. The note quotes the words selected and keeps pointing at them while people type
  around them, in this tab and in the others'. With nothing selected, *Note* leaves the note on
  the block (or on the field, for a rich text field).
- **On a block or a field.** Hover a block's header or a field's label and use the speech
  bubble button, *Add a note on …*. The title, the sidebar's rows (status, dates, terms, the
  authors) and the search and sharing rows take notes too.
- **Mentioning.** The note box offers *Mention someone…*; a chosen person is named in the note
  and hears of it on their dashboard. A reply names the thread's author and everyone who
  replied before, so nobody has to be mentioned twice.

The Notes rail opens at the right with the new note; on a wide screen the entry makes room for
it, so editing and saving go on while it is open. Its *Open* and *Resolved* tabs list the
threads; choosing one scrolls the entry to where it sits and flashes it. A thread shows where
it is (the field's name, the block's name and summary, or the quoted words), its messages,
*Reply*, and *Resolve*. Resolved threads keep their messages and can be reopened.

## What you see

- **Markers.** An amber count on a field's label or a block's header says how many open
  threads sit there (passages count for their block and field); clicking it opens the rail on
  the first of them. Noted passages carry an amber underline, stronger for the thread open in
  the rail; clicking the underline opens its thread. The header's *Notes* button carries the
  count of open threads.
- **The passage moved or changed.** A note follows its words while the entry is edited. When
  the entry is opened again, a note whose stored place no longer holds its words is put back
  on the nearest occurrence of them; when the words are gone, the note stays on its block, and
  the rail says *the text changed* beside it. A block that is removed keeps its notes listed
  under *A removed block* until they are resolved or removed.
- **Checks.** The *Readiness* checks in Search and sharing list the open notes as a warning.
  With *Open notes hold publishing* on under Settings → Writing, an entry that is not live yet
  cannot be published or scheduled while it has open notes; the check says so, and so does the
  refused save.
- **Lists and the dashboard.** The entries list shows an amber count beside an entry that has
  open notes, opening its editor on the rail. The dashboard home's *Notes for you* card lists
  the open threads you started or were named in, newest activity first, with the entry and the
  words quoted; the taskbar counts the ones in entries you have not opened since. Opening an
  entry marks its notes for you as seen.

## Who may do what

Everyone who may edit an entry reads its notes, leaves notes and replies, and resolves or
reopens threads. Authors change and remove their own notes; user administrators (`cms:users`)
remove anyone's. Removing a thread's first note removes its replies. A new entry has no notes
until it is saved: its room, which carries them, opens with the saved entry.

## In code

| Import | What |
| --- | --- |
| `@cossackframework/cms` | `Note`, `NoteThread`, `NoteTarget`, `formatNoteTarget` / `parseNoteTarget` (`entry`, `field:title`, `block:content:<blockId>`, `text:content:<blockId>.text`), `noteThreads`, `mentionsIn`, `mentionToken`, `noteParts`, `checkNoteAction`, `NOTE_LIMITS` (4,000 characters a note, 200 a quote, 500 notes an entry). |
| `@cossackframework/cms/server` | `cms.notes` (`CmsNotes`): `forEntry`, `create`, `edit`, `setStatus`, `remove`, `move`, `counts`, `forUser`, `unseen`, `markSeen`, `entries`, `purgeEntry`. |

The entry's room (`EntryRoom.note`) is how the editor writes notes, so every tab hears of
them. The content API has them too, for other clients:

```http
GET    /api/cms/content/posts/<id>/notes?status=open     → { threads: [{ root, replies }] }
POST   /api/cms/content/posts/<id>/notes                 { target, range?, quote?, body } or { parentId, body }
PATCH  /api/cms/notes/<noteId>                           { body } (its author) and/or { status: "open" | "resolved" } (a root)
DELETE /api/cms/notes/<noteId>
```

Reading takes the entry's read access; writing takes its update access, as a signed-in
session (same-origin) or an application password. A note written through the API shows in
open editors when they next join the room, such as on a reload. Maintenance removes the notes
of entries that no longer exist.
