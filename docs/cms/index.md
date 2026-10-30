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
- [Settings](/docs/cms/settings.md): reading and writing settings, declaring groups and
  subpages, discussions, and the site logo.
- [Block references](/docs/cms/block-references.md): blocks and bindings inside text, such
  as `{{ block core/button … /}}` and `{{ $site.title }}`.

The package `README.md` and `cossack docs --package @cossackframework/cms` cover the data
contract (resources, repositories, collections, blocks) in more depth.

## Entries

| Import | Use |
| --- | --- |
| `@cossackframework/cms` | Client-safe: collections, fields, blocks, rich text, menus, the theme contract, permissions, settings, the extension points, manifests and media helpers. |
| `@cossackframework/cms/server` | Server-only: `createCMS`, the host, repositories, users, taxonomies, menus, settings, files, auth and stores. |

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
| Add dashboard pages | Put pages under `pages/dashboard/...` in the plugin; link them from the `dashboard.nav` slot. |
| Add an operator command | Declare `commands` in the manifest; handle them with `context.commands.add()`. |
| Ship a site design | A plugin with a `theme` field and `templates/`; see [Themes](/docs/cms/themes.md). |
| Let other plugins extend yours | Declare `provides` in the manifest and invoke the points from your code. |
