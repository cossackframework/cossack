# @cossackframework/cms

The Cossack CMS on FastDB: collections defined as data and stored schemaless, blocks, rich
text stored as ProseMirror JSON, taxonomies with nested terms, media, settings, themes,
menus, resources with a schema planner and a migration ledger, authorized repositories,
users and sign-in with authenticator apps and passkeys, the framework stores, an outbox and
plugin hosting. Publishing tools: scheduled entries, preview links, autosaves, revisions you
can compare and restore, automatic and managed redirects, per-entry SEO, resized image
variants with crops and focal points, application passwords for the content API, signed
webhooks, moderated comments, reusable patterns and translations. Forms are built from
input blocks with conditional logic, and each keeps its submissions in a table of its own,
with notifications, webhooks and hooks like Gravity Forms'. Add it to an
application with `cossack add cms`, which renders the shared `auth` and `dashboard` pages
over CMS storage and a default theme into `src/plugins/default-theme/`. It runs on Cloudflare Workers
with FastDB Cloud and on Node.js with `fastdb serve`.

```ts
import { field, type CollectionDefinition } from '@cossackframework/cms';

export const products: CollectionDefinition = {
  name: 'products',
  label: 'Products',
  singular: 'Product',
  path: 'shop',
  taxonomies: ['tags'],
  fields: {
    price: field.number({ required: true, min: 0 }),
    content: field.blocks({ blocks: ['core/heading', 'core/paragraph', 'core/image'] }),
  },
};
```

| Entry | Use |
| --- | --- |
| `@cossackframework/cms` | Collections, blocks, fields, rich text, menus, the theme contract, permissions, settings, extension points, manifests, media helpers (client-safe) |
| `@cossackframework/cms/server` | `createCMS`, repositories, planner, users, taxonomies, menus, settings, files, auth, stores, outbox, Markdown (server-only) |

Data contract:

- Each collection is its own document table, `r__cms__<name>`. Only host fields are typed in
  the database; the host validates content fields, and reads tolerate values that no longer
  fit a changed field. Saving a definition changes only indexes.
- Field groups are meta boxes built from blocks: field blocks laid out with the core layout
  blocks, attached to collections, taxonomies, users and menu items. They compile to field
  declarations, so values are stored flat by name; a `rows` field is a repeater (rows with an
  `_id`, nested without limit) whose indexed row fields keep a derived list beside the
  document for `array::contains` seeks. Conditions on fields clear what they hide on write.
- Each mutation is one atomic batch: record, revision, audit and outbox rows, guarded by
  the operation ID, so a stale edit writes nothing.
- Terms store their ancestors' IDs as a path, so a subtree is a prefix match and a move is
  one statement. Entries hold term IDs in indexed arrays.
- Code-declared resources use strict collections. Generated schema changes are additive;
  renames, backfills, tighter rules and drops are explicit, versioned steps. Each step is one
  batch sent with `ifSequence`; a conflict re-plans.
- A resource is active only when the database records its current declaration.
- Blocks are one tree: `{ id, type, data }`, with `children` under a container (`core/group`,
  `core/columns` holding `core/column`, `core/grid`) and a core-checked `layout` (`hide` by
  container width). A type declares what it holds (`children`) and where it goes (`parent`);
  at most 200 blocks and 4 levels per field. Layouts are blocks, so revisions, patterns and
  the front-end editor cover them; nothing is stored beside the block list.
- A block's `style` holds slugs of the theme's presets (`background`, `text`, `padding`,
  `margin`, `fontSize`) and an `align`; `layout` adds an `anchor` and `className`. A type's
  `supports` narrows what its Style tab offers over its category's defaults. Themes declare
  `presets` (colours, font sizes, spacing) in their manifest, Customize adjusts the palette
  and adds site-level CSS, and `blockStyleAttributes` renders a styled block's wrapper with
  classes and custom properties, so a palette change recolours stored content.
- An entry's content is blocks: posts and pages have a `content` blocks field, and the
  `core/richtext` block is the word processor among them. A collection's `template` is the
  blocks every new entry starts with (`templateLock` keeps them, or their order too); blocks
  of the `data` category store values and render nothing. Rich text is validated against an
  allow-list of nodes, marks and attributes on every write and rendered to escaped HTML; the
  plain text of searchable rich text and blocks fields feeds the full-text index.
- Extension points besides the resource and form hooks: `cms.term.before-save`,
  `cms.comment.before-save` and `cms.menu.before-save` adjust or refuse writes;
  `cms.dashboard.entry-actions`, `entry-columns` and `bulk-actions` add links, plugin
  commands and columns to the dashboard's entry lists.
- A menu is one JSON tree saved with a revision check. Entries and terms are stored by ID and
  resolved when the site renders.
- A plugin runs only when its resources are migrated and an administrator grants what its
  manifest requests. Builds run the plugin policy lints (`cossack plugins check`).
- A theme is a plugin whose manifest has a `theme` field and whose `templates/` files (or
  `ui.ts` `theme` export) are the site templates, picked per page from most specific
  (`entry-posts`, `term-category`) to general (`entry`, `archive`). Themes own templates, not
  routes. Activating one is a settings write; its templates need no grant. A theme's
  `server.ts` exports `loaders` that read data under the plugin's grants for its templates;
  `templates/head.ts` adds stylesheets and fonts from `assets/`; `theme.extends` makes a child
  theme; `theme.areas` declares widget areas; a manifest's `collections` ship site
  collections with the plugin. Editors can choose an entry's template and edit its blocks on
  the public page.
- A form is a `forms` entry whose `body` holds input blocks (`input: { kind }` in the
  declaration), laid out with the containers and shown or hidden by a block's `when`. Its
  submissions are the resource `cms/form_<form id>`, stored in its own table and extended
  when inputs are added. A submission is one batch: the record, a receipt and its
  `form.submitted` outbox event, which sends the form's notifications and webhooks. Hooks:
  `cms.form.validate`, `before-submit`, `prefill`, `confirmation`, `notification` and
  `submitted`.
- Scheduled entries are published by maintenance as a system write, so their outbox events
  and webhooks fire when they go live. A published entry's URL change records a 301 in the
  same batch.
- Preview links, application passwords and recovery codes are stored as SHA-256 hashes.
  Webhook deliveries are queued per webhook from the outbox and signed with HMAC-SHA256.
- After a package upgrade, new host tables and changed built-in collections apply on the
  next request; code-declared resources and plugins still migrate from Tools → Schema.

See the guides with `cossack docs --package @cossackframework/cms`.
