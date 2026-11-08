---
title: 'CMS'
description: 'The Cossack CMS package: what it is, how an application hosts it, and where to extend it.'
---

# CMS

`@cossackframework/cms` is the open-source CMS on RomeDB. Collections are defined as data
in the dashboard and stored schemaless, content is blocks and rich text, and the public
site is drawn by a theme. Plugins add resources, hooks, blocks, dashboard pages, commands
and themes without touching the application's own code.

`cossack add cms` renders the CMS into an application's `auth` and `dashboard` pages and
puts a default theme in `src/plugins/default-theme/` for you to edit or copy. See
[`cossack add cms`](/docs/cossack-cli.md#cossack-add-cms) for what the recipe sets up.

## Guides

- [Plugins](/docs/cms/plugins.md): package a plugin, what its files do, how it is rendered,
  activated and upgraded, and the rules its code must follow.
- [Plugin manifest](/docs/cms/manifest.md): every field of `cossack-plugin.json`.
- [Hooks](/docs/cms/hooks.md): the extension points, how handlers run, and how a plugin
  defines points of its own.
- [Themes](/docs/cms/themes.md): templates, helpers, loaders, options, presets, child
  themes and widget areas.
- [Menus](/docs/cms/menus.md): the menu builder, headings and descriptions, field groups on
  items, mega menu panels, the Navigation block, `helpers.menu()` and the menus API.
- [Live Edit](/docs/cms/site-editing.md): editing an entry and the theme's areas around it in
  place, documents and their revisions, markers, and what stays code.
- [Settings](/docs/cms/settings.md): reading and writing settings, declaring groups and
  subpages, discussions, and the site logo.
- [Multisite](/docs/cms/multisite.md): many sites from one application, one database per
  site, accounts shared across the network, and the network dashboard.
- [Co-editing](/docs/cms/collaboration.md): several people in one entry, live text and
  presence through the entry's room, the shared draft, and the rules that merge changes.
- [Notes](/docs/cms/notes.md): review notes on a passage, a block, a field or the entry,
  mentions, the rail, resolving, and the publishing check.
- [Blocks](/docs/cms/blocks.md): the core block library, sections built from it, the site
  icons, and blocks a theme or plugin adds.
- [Block references](/docs/cms/block-references.md): blocks and bindings inside text, such
  as `{{ block core/button … /}}` and `{{ $site.title }}`.
- [Management API, CLI and MCP](/docs/cms/api.md): manage a site from a terminal or an
  agent with `cossack cms`, the API under `/api/cms`, and the MCP server every site serves.
- [Cache](/docs/cms/cache.md): what the site tells the caches in front of it, how changes
  purge Cloudflare or another CDN, and the Cache tool.

Tools under the dashboard's Tools menu: Health (search and answer engines, crawler visits, 404s),
Links, Redirects, Webhooks, Schema, Export, Cache, Jobs (the outbox: what waits, what failed for
good, plugin schedules), Activity (the audit trail of writes), Find and replace (a phrase across
a collection, previewed first) and Automations (when an entry is published, a form is submitted or
a payment completes, send an email or post to a URL). Content → Calendar lists the month's published
and scheduled entries. Settings → Analytics takes a Cloudflare Web Analytics token or a Google
Analytics measurement ID and adds that service's script to visitors' pages; the site stores no page
views, since that would be a database write per view past the cache. Settings → Reading names a page for missing addresses (served with status 404); Settings
→ General has a maintenance or coming-soon mode (visitors get a 503 holding page, people with
dashboard access see the site) and asks new registrants to confirm their email when the site can
send one. New users can be invited by email instead of given a password; people can delete their
own account from Profile, and sign in with a one-time link emailed from the sign-in page. Ctrl/Cmd+K
opens a palette of every dashboard screen. The entry editor's Assistant box suggests a title, an
excerpt or a summary when the application has an AI provider (`ANTHROPIC_API_KEY`, or a Workers AI
binding `AI`).

The package `README.md` and `cossack docs --package @cossackframework/cms` cover the data
contract (resources, repositories, collections, blocks) in more depth.

## Entries

| Import | Use |
| --- | --- |
| `@cossackframework/cms` | Client-safe: collections, fields, blocks, rich text, menus, the theme contract, permissions, settings, the extension points, manifests and media helpers. |
| `@cossackframework/cms/server` | Server-only: `createCMS`, the host, repositories, accounts (who signs in) and users (a site's members), taxonomies, menus, settings, files, auth and stores. |

Plugin code imports from `@cossackframework/cms` only. The host is handed to a plugin's
`register()` as a context; importing `@cossackframework/cms/server` from plugin source fails
the policy check.

## How an application hosts the CMS

The rendered application builds one host per process or isolate and puts it on every
request:

```ts
import { createCMS } from '@cossackframework/cms/server';
import { plugins } from '@cossackframework/framework/plugins';

const cms = createCMS({ db, modules, resources, plugins, storage, images, mail });
```

- `db` is the RomeDB client. `modules` are the built-in groups of resources, such as the
  content module with posts and pages. `resources` are the application's own declarations.
- `plugins` is the static registry the framework builds from `src/plugins/*/`: each entry
  carries the plugin's rendered manifest, its `server.ts` module, its `ui.ts` module, its
  `templates/*.ts` modules and the URLs of its `assets/`.
- A request middleware sets `cms` and `principal` on the Hono context. Server code reads
  them with `c.get('cms')` and `c.get('principal')`; every repository call takes the
  principal, and the host authorizes the call.

`await cms.ready()` runs once per request. It loads the collections defined in the
dashboard and applies host schema changes a package upgrade brought.

## Data in one paragraph

A resource is a declaration (`name`, `fields`, `access`, `ownership`, `migrations`) that the
planner turns into additive RomeDB DDL; records live in `r__<owner>__<name>`. A collection
is a resource `cms/<name>` stored schemaless, with features such as `content`, `excerpt`,
`featuredImage`, `revisions` and `password`, taxonomies, a public `path` and field groups.
Every mutation is one atomic batch: the record, its revision, an audit row and an outbox
event, guarded by the operation ID so a stale edit writes nothing. After commit, the outbox
delivers `cms.resource.after-commit` to plugins, webhooks and notifications, with retries
per plugin.

## Where to extend

| You want to | Do this |
| --- | --- |
| Store your own records | Declare `resources` in the plugin manifest; read and write them through `context.cms.resource('<plugin>/<name>')`. |
| React to writes, or change them | Register handlers for [hooks](/docs/cms/hooks.md) in `server.ts`. |
| Add content blocks | Declare `blocks` in the manifest; render them from `ui.ts`. |
| Add fields to entries | Declare `fieldGroups` in the manifest: meta boxes stored when the plugin is granted. |
| Arrange an entry editor | Declare `editor` in the manifest: tabs and sidebar boxes added to a collection's editor while the plugin is active. |
| Add dashboard pages | Put pages under `pages/dashboard/...` in the plugin; link them from the `dashboard.nav` slot. |
| Add an operator command | Declare `commands` in the manifest; handle them with `context.commands.add()`. |
| Take payments or ask a model | Ask for `payments` or `ai` in `permissions`; `context.payments.checkout()` and `context.ai.complete()`; handle `cms.payment.event`. The application configures Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) and Anthropic or Workers AI (`ANTHROPIC_API_KEY`, or the `AI` binding). |
| Store files, send email, run work later or on a schedule, read members, cache, hold a key | Ask in the manifest's `permissions` (`files`, `mail`, `jobs`, `users`, `cache`, `secrets`) and `schedules`; use `context.files`, `mail`, `jobs`, `users`, `cache`, `secrets`. See [Capabilities](/docs/cms/plugins.md#capabilities). |
| Ship a site design | A plugin with a `theme` field and `templates/`; see [Themes](/docs/cms/themes.md). |
| Let other plugins extend yours | Declare `provides` in the manifest and invoke the points from your code. |
