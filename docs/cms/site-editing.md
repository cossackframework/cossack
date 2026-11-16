---
title: 'CMS Live Edit'
description: 'Edit an entry and the site around it in place: documents, markers, saving and conflicts, areas with the theme defaults, what stays code.'
---

# CMS Live Edit

Signed-in editors see **Live Edit** in the site taskbar on an entry they may change, and
administrators on every list page too (the home page's latest posts, an archive, a term), for
the frame around it. It opens the page at `?edit`: blocks become clickable, a sheet at the side
edits the selected block's fields and style (a group's Width makes it a band across the page;
its Advanced background takes a gradient, an image, a video and an overlay, see
[Backgrounds](/docs/cms/themes.md#backgrounds)), the Blocks panel shows the page's trees, the
Entry panel its title, slug and terms, and the Text panel its rich text body. Changes stay in a
draft until Save; visitors never see the markers or the editor's code.

## Documents

The page is several block lists at once, and Live Edit edits them side by side:

| Document | What it is | Who edits it |
| --- | --- | --- |
| Content | The entry's blocks field, with its rich text body as the Text panel. | Anyone who may update the entry. |
| Header, Footer bar, Footer widgets, … | The active theme's widget areas on the page, with the blocks the theme ships until the site saves its own. | Users with `cms:appearance` (administrators). |
| A synced pattern | Every pattern the page shows: in the content, in an area or in a menu's mega panel. Clicking a block inside it selects it in the pattern's document, and a change applies everywhere the pattern is used. | Anyone who may update the pattern. |

The Blocks panel lists them in page order, the header first, each with its own tree and *Add
block*. Clicking a block on the page selects it in whichever document it belongs to; a block in
a document the user may not change shows a dotted outline and selects nothing. Each document
saves on its own revision: Save writes every changed document, and a conflict stays on the
document that had it, with its own *Reload*, while the others still save.

Areas take any block except a synced pattern, as Appearance → Widgets does; a Pattern block is
placed in content from the dashboard's editor, which has the pattern picker. The first save of an
area that still shows the theme's defaults stores those blocks for the site, and the theme's
later changes to its defaults no longer apply there; Appearance → Widgets offers *Reset to the
theme's default*.

## How the page and the frame work together

The entry is rendered by the site page and the frame around it by the site layout, so a change
to an area is previewed by the layout: the page keeps the editor's drafts in a small shared
store, the layout renders the changed areas through its own server method a moment after the
last change, and reloads the saved areas when the session ends. At the first paint the page
hands the layout the documents it edits, so the areas carry their markers from the start.

Markers are `display: contents` wrappers the helper adds in edit mode around every block,
naming the block (`data-block-id`), its document (`data-cms-doc`, `entry` for the content) and,
for a document the user may not change, `data-cms-locked`. Themes never see them, and a
visitor's page has none.

## What stays code

Templates are the theme's: the frame's markup, typography and options are not edited on the
site. A theme makes more of its layout editable by declaring more [areas with
defaults](/docs/cms/themes.md#areas-with-defaults). Menus and the site's settings are not
documents yet: a menu is edited in the dashboard, which the navigation block links to, and the
site's title and logo under Settings → General.
