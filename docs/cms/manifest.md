---
title: 'CMS Plugin Manifest'
description: 'Every field of cossack-plugin.json, what it declares and how it is checked.'
---

# CMS Plugin Manifest

`cossack-plugin.json` is the only thing the host trusts about a plugin before an
administrator grants it. It is validated twice: the CLI checks its structure when it
renders the package, and the CMS host checks every CMS field (`manifestProblems` from
`@cossackframework/cms`) when it starts. A plugin with problems is listed as inactive with
the reason, and none of its code runs.

A field the host does not know is a problem, so a typo in a field name fails loudly.

```json
{
  "schemaVersion": 1,
  "name": "support-desk",
  "version": "1.0.0",
  "description": "Support tickets",
  "author": "Acme",
  "authorUrl": "https://acme.example",
  "compatibility": { "@cossackframework/cms": ">=0.9.0" },
  "resources": [{ "name": "tickets", "titleField": "subject", "ownership": true, "fields": { "...": "..." } }],
  "blocks": [{ "name": "support-desk/contact", "label": "Support contact", "fields": { "...": "..." } }],
  "hooks": [{ "point": "cms.resource.before-write", "version": 1 }],
  "permissions": { "resources": { "cms/posts": ["read"] }, "define": ["support-desk:triage"] },
  "ui": { "slots": { "dashboard.nav": [{ "label": "Support", "href": "/dashboard/support" }] } },
  "commands": [{ "name": "close-all", "description": "Close every open ticket.", "permission": "support-desk:triage" }]
}
```

## Identity

| Field | Rule |
| --- | --- |
| `schemaVersion` | Always `1`. |
| `name` | 1 to 64 lowercase letters, digits and single hyphens. Not `cms`, `cossack`, `core`, `framework` or `app`. It is the directory under `src/plugins/`, the owner of the plugin's resources (`<name>/<resource>`), the prefix of its blocks (`<name>/<block>`), its permissions (`<name>:<permission>`), its extension points (`<name>.<point>`) and its translation and configuration namespace (`<name>::`). |
| `version` | A semantic version. Must equal the package version. |
| `description` | At most 500 characters, shown on the plugin's card. |
| `author`, `authorUrl` | A name of at most 120 characters and an `http(s)://` address, shown on the card. |
| `logo`, `cover` | A PNG, JPEG, WebP, GIF, AVIF or SVG file in `assets/`, such as `assets/logo.png`. Defaults: `assets/logo.*` (square) and `assets/cover.*` (4:3). |
| `source` | The source directory inside the package. Default `plugin`. |
| `package` | Written by `cossack add plugin` into the rendered `plugin.json`: the npm package the plugin came from. Not set by hand. |

## Compatibility and dependencies

| Field | Rule |
| --- | --- |
| `compatibility` | Package names to version ranges, such as `{ "@cossackframework/cms": ">=0.9.0" }`. Ranges take `^`, `~`, `>=`, `<=`, `>`, `<`, `=`, `x` wildcards and `\|\|`. |
| `dependencies` | npm packages the plugin's source imports, with ranges. `cossack add plugin` adds them to the application's `package.json`; run `pnpm install` afterwards. |

## `resources`

Records the plugin owns. Each is a resource declaration like `defineResource()` takes,
with the owner set to the plugin name by the host, stored in `r__<plugin>__<name>`.

```json
{
  "name": "tickets",
  "label": "Tickets",
  "titleField": "subject",
  "ownership": true,
  "fields": {
    "subject": { "kind": "string", "required": true, "max": 120, "search": true },
    "status": { "kind": "enum", "values": ["open", "closed"], "required": true, "default": "open", "index": true },
    "body": { "kind": "text", "search": true }
  },
  "access": {
    "read": "authenticated",
    "create": "authenticated",
    "update": { "any": ["owner", { "permission": "support-desk/tickets:update" }] },
    "delete": { "permission": "support-desk/tickets:delete" }
  },
  "migrations": [{ "version": 1, "kind": "backfill", "field": "status", "value": "open" }]
}
```

- `fields`: `string`, `text`, `enum` (`values`), `integer`, `bigint`, `number`, `boolean`,
  `datetime` (Unix milliseconds), `reference`, `json`, `list`, `vector`, `blocks`,
  `richtext` and `rows`; options `required`, `nullable`, `default`, `label`, `max`, `min`,
  `pattern`, `unique`, `index` and `search` (full text). `slugFrom`, `taxonomy` and `media`
  derive a slug, index term IDs and hold a media file ID.
- `access` per action (`read`, `create`, `update`, `delete`): `public`, `authenticated`,
  `owner` (needs `ownership: true`), `none`, `{ permission }`, `{ where: { field: value } }`
  or `{ any: [...] }`. An unlisted action needs the permission
  `<plugin>/<resource>:<action>`.
- `indexes`: `{ name, fields, unique? }`.
- `revisions` (default true) keeps a snapshot of every write. `schemaless: true` types only
  the host fields in the database.
- `migrations`: explicit, versioned steps that run once each in order: `backfill`
  (`field`, `value`), `rename` (`from`, `to`; keep the old field declared), `tighten`
  (`field`) and `drop` (`field`). Generated schema changes are additive; anything stricter
  needs a step.

A resource whose `owner` is set to another name, or declared twice, is a problem.

## `collections`

Site collections the plugin ships, such as a portfolio theme's `projects`. Each is a
collection definition (the same shape `cms.saveCollection()` takes, without `builtin` and
`plugin`, which the host sets) stored as `cms/<name>`. It gets entries with URLs, an
archive and a dashboard section like posts, is migrated and granted with the plugin, is
hidden while the plugin is inactive, and counts as the plugin's own resource for its
repositories and the policy lints. A name another module or plugin declares makes the
plugin invalid.

## `blocks`

Block types named `<plugin>/<name>`, rendered on the site by the `blocks` export of
`ui.ts`.

## `fieldGroups`

Field groups the plugin ships: meta boxes of typed fields attached to collections,
taxonomies, users or menu items, in the shape `cms.saveFieldGroup()` takes, with IDs
starting with `<plugin>-`. When the plugin is granted they are stored with the other
groups, tagged with the plugin, and their targets' schemas are planned; granting it again
after an upgrade replaces them. The dashboard shows them read-only, the collection manager
cannot detach them, and they stay, with their fields' values, while the plugin is inactive.

```json
"fieldGroups": [{
  "id": "shop-shipping", "title": "Shipping",
  "targets": [{ "kind": "collection", "name": "products" }],
  "blocks": [{ "_id": "weight", "type": "field/number", "data": { "label": "Weight", "name": "weight", "min": 0 } }]
}]
```

## `editor`

Tabs and sidebar boxes the plugin adds to a collection's entry editor while it is active,
its own collection or another's: a partial editor layout per collection (see
`specs/cms-editor-layout.md` and the `@cossackframework/cms` README), with `tabs` (`editor/tab` blocks) and `sidebar` blocks, which
place meta boxes (`editor/box`). The host prefixes a tab's ID with the plugin's name; the
editor's address names the open tab by that ID (`?tab=support-desk-support`), so a tab ID is
lowercase letters, digits and single hyphens, at most 40 characters with the prefix, and
never `json` or `sidebar`. A layout the administrator saved keeps a tab or a box it already
placed, so moving a plugin's tab holds.

```json
"editor": [{
  "collection": "products",
  "tabs": [{ "_id": "shipping", "type": "editor/tab", "data": { "label": "Shipping" }, "children": [{ "_id": "box", "type": "editor/box", "data": { "box": "group:shop-shipping" } }] }]
}]
```

```json
{
  "name": "support-desk/contact",
  "label": "Support contact",
  "description": "An email address to write to.",
  "icon": "letter",
  "category": "widgets",
  "keywords": ["email"],
  "fields": { "email": { "kind": "string", "required": true, "max": 120, "label": "Email" } }
}
```

| Field | Meaning |
| --- | --- |
| `fields` | The block's data, validated on every write like resource fields. |
| `icon` | A Solar icon name for the block picker. |
| `category` | The picker's group: `text`, `media`, `design`, `widgets`, `embeds`, `data`, `form` or `field`. Default `widgets`. |
| `keywords` | Other words the picker's search finds the block by. |
| `common` | Offered everywhere blocks go, forms and field groups included. |
| `children` | `{ allowed?, max? }`: the block holds other blocks. |
| `parent` | Types the block goes inside only, as a column goes inside columns. |
| `supports` | `color`, `spacing`, `typography`: what the Style tab offers, over the category's defaults. |
| `input` | `{ kind }`: the block is a form input collecting one value under its `name` field. |
| `field` | `{ kind }`: the block is a field of a field group. |

## `hooks`

Extension points the plugin's `server.ts` registers handlers for, each with the version
the handler was written against:

```json
"hooks": [
  { "point": "cms.resource.before-write", "version": 1 },
  { "point": "shop.order-placed", "version": 1 }
]
```

- A CMS point (`cms.*`) must exist and the version must match the current one, or the
  manifest is invalid. The points and their versions are in [Hooks](/docs/cms/hooks.md).
- A plugin point (`<other-plugin>.<name>`) is checked when the host loads both plugins:
  no installed plugin providing it, or another version, makes this plugin invalid.
- Every entry becomes a grant, `hook:<point>`, that the administrator approves.
- A handler for a point not listed here fails the policy lint and `register()`.

## `provides`

Extension points the plugin defines for other plugins, named `<plugin>.<name>`:

```json
"provides": [
  { "point": "shop.order-placed", "kind": "action", "version": 1, "timeoutMs": 10000, "description": "An order was placed." },
  { "point": "shop.price", "kind": "filter", "version": 1 }
]
```

`kind` is `action` or `filter`; `version` starts at 1 and is incremented for incompatible
payload changes; `timeoutMs` (1 to 600,000, default 5,000) is the per-handler deadline;
`description` is at most 300 characters. The host builds the points before any plugin's
`register()` runs, so order never matters. See
[Points a plugin provides](/docs/cms/hooks.md#points-a-plugin-provides).

## `permissions`

```json
"permissions": {
  "resources": { "cms/posts": ["read"], "cms/pages": ["read", "update"] },
  "network": ["api.example.com", "*.stripe.com"],
  "define": ["support-desk:triage"]
}
```

| Field | Meaning |
| --- | --- |
| `resources` | Actions on resources the plugin does not own. Each becomes a grant `resource:<id>:<action>`; `context.cms.resource(id)` refuses an action that is not granted. |
| `network` | Host names (`example.com`, `*.example.com`, `localhost`) that `context.fetch` may contact. Each becomes a grant `network:<host>`. |
| `define` | Permissions of the plugin's own, named `<plugin>:<name>`, for roles to hold. Access rules, commands and slot links may name them. |

## `ui`

```json
"ui": { "slots": { "dashboard.nav": [{ "label": "Support", "href": "/dashboard/support", "permission": "support-desk:triage" }] } }
```

Links shown in dashboard slots while the plugin is active. The slots are `dashboard.nav`
(the navigation) and `dashboard.overview` (the overview page); `label` is at most 60
characters, `href` a same-site path, and `permission` hides the link from users without
it. Components for `dashboard.overview` come from the `slots` export of `ui.ts`.

## `commands`

```json
"commands": [{
  "name": "close-all",
  "description": "Close every open ticket.",
  "permission": "support-desk:triage",
  "options": { "reason": { "type": "string", "description": "Why the tickets close." } }
}]
```

Run as `cossack <plugin>:<name> --<option> <value>`. `name` is lowercase, unique in the
plugin and at most 41 characters; options are `string`, `number` or `boolean`, with
`required` and `description`. The handler comes from `context.commands.add()`.

## `theme`

Makes the plugin a theme. See [Themes](/docs/cms/themes.md#the-manifest) for the fields:
`label`, `description`, `locations`, `areas`, `options`, `presets` and `extends`.

## What a manifest asks the administrator for

`requestedGrants(manifest)` from `@cossackframework/cms` lists them: `plugin:enabled` for
every plugin, then `resource:<id>:<action>` for `permissions.resources`, `network:<host>`
for `permissions.network` and `hook:<point>` for `hooks`. A manifest with only a `theme`
field asks for nothing and is managed under Appearance.
