# CMS dashboard

Status: implemented on branch `cms-foundation`. Follows stage 3 of the
[CMS and app builder plan](cms-app-builder.md). Updated 2026-10-16. See [Outcome](#outcome).

The first CMS slice shipped its own `/cms` shell, sign-in and a generic record
editor. This stage replaces them with the scaffold's `auth` and `dashboard`
features and adds the WordPress-style content tools a site needs.

## Decisions

- **One dashboard.** `cms` requires `auth` and `dashboard`. Their pages are shared
  with ORM applications; only the storage modules differ. With `cms`, auth stores
  users, roles, sessions and reset tokens in FastDB. The `database` feature stays
  optional and unrelated to auth.
- **Storage seam.** These modules are rendered per auth store, with one API:
  `src/auth.ts`, `src/services/users.ts`, `src/services/roles.ts`,
  `src/services/rbac.ts`, `src/lib/permissions.ts` and `src/dashboard/access.ts`
  (navigation and brand). ORM models, migrations and seeders are not rendered
  for the FastDB store.
- **No FastDB driver in `auth`.** The package already takes stores. The CMS
  supplies the session store, the credential verifier, reset tokens and the
  OAuth state store. OAuth sign-in on the FastDB store is a follow-up; the recipe
  rejects `--auth-methods oauth` with `cms` until then.
- **Routes.** Management lives under `/dashboard`; `/cms` is removed. First-run
  setup is `/auth/setup`. Plugins add pages under `src/pages/dashboard/`.
  Resources without a dedicated screen use `/dashboard/content/<owner>/<name>`.
  The CLI signs in through `POST /api/auth/session`, the auth kit's JSON login
  handler.
- **Navigation.** Dashboard, one entry per collection (Posts with Categories
  and Tags, Media, Pages, Products, …), plugin resources, Collections (the
  builder, with Taxonomies and Blocks), Plugins, Users, Roles, Settings
  (General, Writing, Reading, Media), Tools (Schema). Profile and Sessions stay
  in the account menu. Items show only with their permission. Entries of every
  collection use one editor at `/dashboard/content/<collection>`.
- **Roles.** Administrator (`*`), Editor (all content, terms, media),
  Author (own posts, uploads), Subscriber (profile only). Permissions are
  patterns: `cms:<area>` for host areas and `<resource>:<action>` for records.
  `cms:users` manages accounts; `cms:roles` defines roles and chooses users'
  roles. A user manager without `cms:roles` adds users with the default role and
  cannot change accounts that can manage roles, so it cannot take over an
  administrator. ORM applications apply the same rule with the `admin` role.
- **Avatars.** With the CMS, profile pictures upload to the media library (still
  and animated images, 5 MB) and show at once; the user or a user manager may
  change them. ORM applications without file storage keep an image URL.
- **Collections.** Content types are collections: `posts` and `pages` are
  built in, and administrators add others, such as `products`, in the
  dashboard's collection builder. A collection definition is data: label, title
  field, slug, publish workflow, nesting, taxonomies, public URL path and fields.
  Built-in collections keep their core fields and accept added ones.
- **Schemaless storage.** Each collection is its own document table,
  `r__cms__<name>`, without `STRICT`. Only system fields are typed in the
  database; the host validates content fields against the definition, and
  reads tolerate values that no longer fit a changed field. Saving a definition
  is one migration step that records the declaration hash and the definition
  row together, adding or dropping only indexes (unique, search, term arrays).
  A stale isolate that sees a newer hash reloads definitions instead of failing.
- **Blocks.** A `blocks` field holds an ordered list of `{ id, type, data }`.
  Block types declare fields like collections do. Built-in types: paragraph,
  heading, image, gallery, quote, list, code, button, embed and divider.
  Plugins add types through their manifest's `blocks` and render them with
  components from `ui.ts`. The host validates each block's data on write.
- **Content.** Markdown bodies are rendered on the server with raw HTML
  escaped. Publishable collections have draft, pending review, scheduled,
  published and trash states; published entries are public, the others only to
  their authors and editors. Scheduling, previews, revisions, redirects, SEO,
  comments, patterns and translations are in [CMS essentials](cms-essentials.md).
  Hierarchical collections nest through `parent`; a page URL is its ancestor
  slugs.
- **Slugs.** `field.slug('title')` derives a slug when the field is empty and
  appends `-2`, `-3`, … until it is unique. Editors see the slug follow the
  title until they edit it.
- **Taxonomies.** Terms are rows in `cms_terms` with a materialized path of
  ancestor IDs (`/a/b/`). A subtree is a prefix match, a move is one `UPDATE`
  of the prefix, and deleting a term moves its children to its parent in the
  same batch. Records hold term IDs in indexed arrays (`USING ARRAY`), so an
  archive is `array::contains` over a term and its descendants. Built-in:
  `categories` (hierarchical) and `tags`, both on posts. Administrators add
  taxonomies and choose the collections that use them.
- **Media.** Metadata, alt text and image size in `cms_files`; bytes in object
  storage: R2 (`MEDIA` binding) on Workers, S3 on Node when `S3_BUCKET` is set,
  otherwise a local directory. Declared image and PDF types must match their
  file signature. Files are served at `/media/<id>/<name>` with `nosniff` and a
  restrictive CSP.
- **Settings.** `cms_settings` rows, one per key, validated by declared groups
  that reuse field declarations. Cached per isolate for 30 seconds and dropped
  on write. Registration and the default role are General settings; the home
  page source and posts per page are Reading settings.
- **Public site.** `/` follows Reading settings (unless the examples home is
  present). One lowest-priority catch-all route serves collection archives and
  entries at their paths (`/posts`, `/posts/<slug>`, `/products/<slug>`),
  term archives (`/category/<path>`, `/tag/<slug>`) and pages at their nested
  paths. `/feed` is the posts feed; media is served at `/media/<id>/<name>`.

## Done when

A generated Node application and the same application on Workers pass, against
`fastdb serve`: setup, sign-in and sign-out through `/auth`, user, role and
session management, posts and pages with generated slugs, nested categories and
tags with archives, media upload and serving, settings that change registration
and the home page, and a plugin page under `/dashboard`.

## Outcome

| Area | Delivered | Verified by |
| --- | --- | --- |
| CMS package | Collections (`CollectionDefinition`, `collectionResource`, `saveCollection`, `deleteCollection`), schemaless resources, `{ where }` access rules, list filters, order, offset and counts, generated slugs, blocks (`CORE_BLOCKS`, plugin `blocks`), taxonomies (`CmsTaxonomies`, `saveTaxonomy`), settings (`CmsSettings`), media metadata and signature checks, users, roles and reset tokens, Markdown rendering, `DEFAULT_ROLES` | 57 tests: live suites for collections (schemaless tables, index changes, stale isolates, built-in extension, plugin blocks, deletes), content (slugs, private drafts, filters, nested pages without cycles, term moves and deletes, tags, settings, users, reset tokens, media), and unit tests |
| Scaffold | `cms` requires `auth` and `dashboard`; `template/cms-store` replaces the storage modules; the shared layout reads `src/dashboard/access.ts`; CMS screens under `src/pages/dashboard/(cms)/`; setup at `/auth/setup`; the site under `src/pages/(site)/`; R2, S3 or local media | 5 recipe tests and the shared auth, dashboard and formatting suites |
| Framework | Guard chains replace the response only with a `Response` (a guard may `return next()`); client builds strip unused CMS server and FastDB imports from components | Transport security and security plugin tests |
| Generated app | The flow in [Done when](#done-when) on Node and Workers, and a browser check of the editor and the collection builder | `generated-runtime-cms.test.js`, `generated-runtime-cms-plugins.test.js` |

Findings:

- SSR ignores `redirect()` from `init()`; redirects belong in middleware. The login page's
  setup redirect lives in the auth guard, and nested pages redirect in the catch-all's middleware.
- A root catch-all route's middleware also runs for routes registered after it, such as
  `/crpc`, so it acts only on page reads.
- FastDB rejects a bound `LIMIT` on a `search::text` join with a datatype mismatch; the
  repository inlines the validated limit. Requested FastDB change: accept the bound limit.
