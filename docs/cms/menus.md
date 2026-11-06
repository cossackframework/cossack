---
title: 'CMS Menus'
description: 'Build navigation menus: items, headings, descriptions, field groups, mega menu panels, the navigation block, the menu helper and the menus API.'
---

# CMS Menus

A menu is a tree of items an administrator builds under Appearance → Menus and assigns to one
of the active theme's locations, such as `primary` or `footer`. Themes render a location with
`helpers.menu()`, and editors place one anywhere blocks go with the Navigation block. Menus
are small documents: one row per menu with its items as JSON and a revision, so a stale editor
writes nothing.

## Items

An item points at an entry, a collection's archive, a term or a URL, or is a heading. Entries
and terms are stored by ID: a renamed page shows its new title and URL, and an item whose
target is gone (a deleted page, a draft) is left out when the site renders, its children
moving up a level.

| Kind | What it is | Added from |
| --- | --- | --- |
| Entry | A page, post or entry of another collection with a URL. | The collection's box in the sidebar; search finds older entries. |
| Archive | A collection's archive, such as all posts. | "All posts (archive)" in the collection's box. |
| Term | A category, tag or other term with a URL. | The taxonomy's box. |
| Custom link | Any URL: `https://`, `http://`, `/`, `#`, `mailto:` or `tel:`. | Custom links. |
| Heading | A label without a URL that names a column of links in a mega menu. | Headings. |

Each item has a **label** (empty uses the entry's title, the collection's label or the term's
name), a **description** of at most 300 characters shown under the link in a mega menu, and
**Open link in a new tab**. The Advanced tab adds **CSS classes** for the theme's stylesheet
and **custom attributes** on the link, such as `data-track` or `rel`; `href`, `class`,
`target`, `style` and event handlers cannot be set.

Drag an item by its handle to move it; dragging sideways nests it. The arrow keys on a handle
and the Move buttons do the same. Menus hold at most 300 items, five levels deep.

### Field groups on items

A [field group](/docs/cms/manifest.md) whose targets include **Menu items** adds a Fields
tab to every item: an icon, a badge, a color, anything the theme wants. The default theme
ships one, *Menu item details*, with an **Icon** (an image or SVG from the media library,
shown before the link in a mega menu) and a **Badge** (a short word after the link, such as
"New"). Values are checked against the group's fields on save and arrive typed in the view
(`fields`): media as `MediaView`, references with titles and URLs, blocks rendered.

## Mega menus

A top-level item opens as a **mega menu** when it has a **panel** or a **heading** among its
children; otherwise it opens as a dropdown. Nothing else decides it.

- **Headings** group the links under them into columns: nest a heading under the item, then
  the links under the heading. Links before the first heading form a column of their own.
- The **panel** is a synced [pattern](/docs/cms/index.md#patterns) chosen on the item's
  General tab (Edit pattern and New pattern open the pattern editor). It is the extra content
  a dropdown cannot say: a featured card, a call to action, latest posts, an image. The site
  renders it like a widget area, media and latest entries resolved, `{{ $site.… }}` and
  `{{ $user.… }}` bindings read, and shows it beside the columns. A deleted pattern leaves a
  plain dropdown. One pattern can serve several items, menus and languages.

Links in a mega panel show their description, and their icon and badge when the field group
sets them.

## In themes

Templates get every location's menu in `site.menus[location]`, each item a `MenuItemView`:
`id`, `label`, `url` (null for a heading), `kind`, `newTab`, `description`, `className`,
`attributes`, `fields` (typed field group values), `panel` (the pattern rendered as blocks, or
null) and `children`. An unassigned `primary` location lists the published top-level pages.

Most themes render a location in one line:

```ts
${helpers.menu('primary')}
${helpers.menu('footer', { style: 'inline', label: __('Footer') })}
```

`helpers.menu(source, options)` takes a location name or items, and renders a `nav` in one of
three styles; it returns null for an empty menu.

| Style | Renders |
| --- | --- |
| `dropdowns` (default) | A header menu: one row, a dropdown under an item with children, a mega panel under an item with a panel or heading children, and below the `collapse` width a hamburger button opening a drawer (see [Small screens](#small-screens)). Dropdowns open on hover and keyboard focus. |
| `inline` | One row of links with children flattened, for footers. |
| `list` | The whole tree as nested lists, for sidebars. |

`label` names the `nav` for assistive technology (the location's name by default) and `class`
adds class names to it. The markup uses `cms-nav-*` and `cms-mega-*` classes styled in
`cms/blocks.css` with the UI kit's variables, so the theme's accent applies; a theme restyles
them in its own stylesheet, or draws the menu itself from `site.menus` as the fallback theme
does. The current page's link carries `aria-current="page"`. Each item's class names and
attributes land on its link.

`motion` chooses how dropdowns and mega panels open, as `data-motion` on the `nav`:

| Motion | Opens |
| --- | --- |
| `rise` (default) | Fades in and lifts into place. |
| `fade` | Fades in. |
| `scale` | Grows from the top edge. |
| `none` | Switches. |

All of them are CSS: opening is immediate, closing waits 80 ms so a pointer moving diagonally
toward a panel does not make it flicker, and `prefers-reduced-motion` turns every preset into
a switch. Following a link closes the menu it is in, even though client-side navigation keeps
the header on the page: the site layout drops the link's focus, closes the drawer and keeps
the panel shut until the pointer leaves the item or focus returns (a modifier click or a
new-tab link is left alone). A preset is the closed transform in `--cms-nav-closed`; a theme tunes them all
through the `--cms-nav-duration`, `--cms-nav-ease`, `--cms-nav-offset` and
`--cms-nav-close-delay` variables, on `.cms-nav` for the whole site or on one `nav` through
`class`, and adds its own by passing another name, say `swing`, and setting
`.cms-nav[data-motion="swing"] { --cms-nav-closed: rotateX(-20deg) }` in its stylesheet. The
drawer on small screens enters the same way.

## Small screens

Below the `collapse` width (`md`, 768px, by default; `lg` folds at 1024px for tablets too) the
row becomes a hamburger button, and the button opens a drawer under the header with the menu
as a tree: a link with children folds, with its link still a link; a heading labels the group
under it; panels are not shown. The drawer is positioned against the header, so give the
header `position: relative` as the default theme does, and the page does not move.

A phone rarely wants the desktop tree, so the drawer can show another menu: the theme
declares a second location, `mobile` in the default theme, administrators assign a shorter
menu to it under Appearance → Menus, and the template or block names it:

```ts
${helpers.menu('primary', { mobile: 'mobile', collapse: 'lg' })}
```

`mobile` takes a location name or items. While the location has no menu, the drawer shows
the primary menu's own tree, so a site that never assigns one still works. Headless clients
read the two locations separately, `GET /api/cms/menus/primary` and `/mobile`.

## The Navigation block

The **Navigation** block renders a location through the same helper, so editors place a menu
in widget areas (a footer, a sidebar) and in content. Its fields are the location, chosen from
the themes' declared locations, the style, the animation (the motions above; *Rise* by
default), and for the header style the small-screen location (*Small screens*; empty shows
the same menu) and the width the row collapses below. The default theme's header block names
the `mobile` location. Under Appearance → Widgets a navigation block in a footer area with the
`inline` style is the usual footer menu.

## API

`GET /api/cms/menus/<location>` returns the location's menu as the site renders it:

```json
{
  "location": "primary",
  "assigned": true,
  "items": [
    { "id": "products", "label": "Products", "url": "/products", "kind": "link", "newTab": false, "description": "Everything we make",
      "className": "", "attributes": {}, "fields": {}, "panel": [{ "_id": "card", "type": "core/card", "data": { "title": "Try it free" }, "html": {}, "media": {} }],
      "children": [
        { "id": "teams", "label": "By team", "url": null, "kind": "heading", "description": "", "fields": {}, "panel": null,
          "children": [{ "id": "sales", "label": "Sales", "url": "/sales", "kind": "link", "description": "Close deals faster", "fields": { "badge": "New" }, "panel": null, "children": [] }] }
      ] }
  ]
}
```

`assigned` is false when no menu is at the location; `items` then lists the top-level pages
for `primary` and nothing elsewhere. Typed `fields` and the rendered `panel` are the same
shapes themes get, so a headless client renders them with its own components.

Menus are also managed from outside the dashboard, by people with the appearance permission:
`GET|POST /api/cms/appearance/menus` and `GET|PATCH|DELETE /api/cms/appearance/menus/<id>` hold
the stored trees (`{ name, items, locations, rev }`; items may leave out their IDs), and
`/api/cms/appearance/locations` the themes' locations with the menu at each. The `cossack cms
menus` and `locations` commands and the `create_menu`, `update_menu` and
`assign_menu_location` MCP tools call them, so a script or an agent builds a mega menu from a
JSON tree and places it at `primary`; see [Management API, CLI and MCP](/docs/cms/api.md).

## Hooks and languages

A plugin adjusts or refuses a menu before it is saved with the `cms.menu.before-save` filter
(see [Hooks](/docs/cms/hooks.md)). On a site with several languages a location has one menu
per language, and entry items link to the page's translation; see
[Languages](/docs/cms/languages.md#menus-terms-and-settings).
