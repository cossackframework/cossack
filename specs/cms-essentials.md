# CMS essentials

Status: implemented on branch `cms-foundation`. Follows the [dashboard](cms-dashboard.md) and
[appearance](cms-appearance.md) stages. Updated 2026-10-17. See [Outcome](#outcome).

The WordPress features sites still need in 2026: scheduling and previews, revisions,
redirects, SEO, responsive images, API tokens and webhooks, comments, patterns, translations
and stronger sign-in.

## Decisions

### Content model

- **Statuses.** `draft`, `pending` (pending review), `scheduled`, `published`, `trash`. Visitors
  still read `published` only. The editor's Publish box picks the status from a select.
- **Core fields.** Every collection also gets `seo`, `locale` and `translationGroup`; a
  collection with comments gets `commentsOpen`. Schemaless resources take up to 64 fields.
- **Group fields.** `field.group({ … })` is a JSON object with declared subfields (scalars and
  media), validated and media-checked like top-level fields. `seo` is one.
- **Field order.** A built-in collection stores `fieldOrder`, so the builder can order its
  core fields among added ones. New fields go last. Fields can be dragged, like menu items.
- **Upgrades apply themselves.** When the host finds newer host tables or a built-in
  collection whose declaration changed (after a package upgrade), it applies those steps on
  the next request, as saving a collection does. Code-declared resources and plugins still
  migrate from Tools → Schema.

### Scheduling and previews

- **Scheduling.** Saving `published` with a future publication time stores `scheduled`;
  `scheduled` with a past time stores `published`. Maintenance publishes due entries as
  `system:scheduler`, so webhooks fire when the entry goes live. Maintenance runs every
  minute (Node interval, Workers cron `* * * * *`).
- **Previews.** `/preview/<collection>/<id>` renders an entry with the theme for users who can
  edit it, from their newest autosave when it is newer than the entry.
- **Preview links.** A link adds `?token=`, a random 32-byte token stored as a SHA-256 hash
  with the entry and an expiry (7 days). Anyone with it sees the saved entry; the content API
  accepts it as `?preview=`. Editors can revoke an entry's links. `preview` is a reserved path.

### Revisions and autosave

- **Compare and restore.** A revisions screen compares any two revisions field by field,
  with word-level diffs for text and rich text (by paragraph). Restoring copies every field
  except status and publication time into a new revision.
- **Autosave.** The editor saves its form values every 30 seconds while there are unsaved
  changes, one row per user and entry (`new` for unsaved entries), up to 1 MB. A newer
  autosave than the entry is offered for restore. Saving the entry deletes it; maintenance
  drops autosaves older than 30 days.

### Redirects

- **Table.** `cms_redirects`: an exact source path or a prefix (`/old/*` → `/new/*`), a
  target, and the status: 301, 302, 307, 308 or 410 (gone). Kept: hits and the last hit.
- **When they apply.** Only for paths without content, as WordPress's old slugs do, so a
  redirect never hides a live page. Exact sources before the longest prefix. The query
  string is kept.
- **Automatic 301s.** When a published entry's URL changes (slug, parent, language), the same
  batch records old → new, retargets redirects that pointed at the old URL, and drops one
  whose source is the new URL. A collection or taxonomy path change adds a prefix redirect
  and one for the archive. A term slug change redirects the term archive.
- **Manager.** Tools → Redirects, with permission `cms:redirects` (Administrator).

### SEO

- **Per entry.** `seo`: title, description, social image, canonical URL and noindex, edited in
  an SEO box with a search-result preview, for collections on the site.
- **Head.** Title (SEO title, or the entry title, separator, site title), description,
  Open Graph and Twitter cards, canonical link (absolute: `APP_URL` or the request origin),
  robots `noindex` for the entry or the whole site.
- **Sitemaps.** `/sitemap.xml` indexes `/sitemap-<collection>-<n>.xml` (1,000 URLs, published,
  indexable, with `lastmod`) and `/sitemap-<taxonomy>.xml`. Off when search engines are
  discouraged.
- **robots.txt.** Disallows `/dashboard/`, `/api/`, `/auth/` and `/preview/`, names the sitemap,
  appends the SEO settings' extra rules; `Disallow: /` when discouraged.
- **Structured data.** JSON-LD: `WebSite` with a `SearchAction` on the home page, `BlogPosting`
  for posts, `WebPage` for other entries, `BreadcrumbList` for nested ones.
- **Settings → SEO.** Title separator, default social image, extra robots.txt rules.

### Responsive images

- **Transformer.** The host takes an `ImageTransformer`: the Cloudflare Images binding
  (`IMAGES`) on Workers, `sharp` on Node, loaded lazily. Without one, images serve as uploaded.
- **Variants.** `/media/<id>/<name>?w=<width>&v=<version>` with widths 320, 640, 960, 1280,
  1920 and 2560, optional `h` with `fit=cover`, and the format from `Accept` (AVIF, WebP, else
  the original; `Vary: Accept`). Variants are stored next to the original under
  `variants/<id>/` and served as immutable. SVG and GIF are never transformed.
- **Crop and focal point.** Set on the media screen. The crop applies to every variant; the
  focal point is the gravity of `fit=cover`. `cms_files` gains the columns.
- **Markup.** `MediaView` carries `srcset`, `sizes`, width and height; the default theme, core
  image and gallery blocks and rich-text images use them.

### API tokens and webhooks

- **Application passwords.** Per user, named, `read` or `write`, shown once:
  `cms_<id>.<secret>`, stored as SHA-256. Sent as `Authorization: Bearer`, accepted only under
  `/api/`. The principal is the user's current one; read tokens may only GET. Profile →
  Application passwords creates, lists (last used) and revokes them.
- **Content API writes.** `POST /api/cms/content/<collection>`, `PATCH …/<id>` with `rev`,
  `DELETE …/<id>?rev=`, and media uploads. Token requests skip the same-origin check;
  session requests keep it.
- **Webhooks.** Events `entry.created`, `entry.updated`, `entry.published`, `entry.unpublished`,
  `entry.deleted`, filtered by collection. An after-commit handler queues one delivery per
  matching webhook in `cms_webhook_deliveries`; delivery runs after writing requests and in
  maintenance: POST JSON with `X-Cossack-Event`, `X-Cossack-Delivery` and an HMAC-SHA256
  signature over `<timestamp>.<body>`. Retries back off over 6 attempts. HTTPS only, except
  loopback hosts. Tools → Webhooks (`cms:webhooks`) lists deliveries and sends tests.
- **Events.** `ResourceEvent` gains `previousStatus`, so publishing is detectable.

### Comments

- **Built in, not a plugin.** Comments need host tables, theme rendering, settings and a
  moderation screen; plugins cannot ship those today.
- **Storage.** `cms_comments`: entry, parent (threads), author (user or name, email, URL),
  content, status (`pending`, `approved`, `spam`, `trash`), a SHA-256 of the IP address.
- **Where.** A collection option (posts on), and per entry `commentsOpen`.
- **Posting.** `POST /api/cms/comments`: the entry must be published and open. Turnstile when
  `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set, a honeypot, one comment per IP every
  15 seconds. Settings → Discussion: sign-in required, name and email required, close after N
  days, thread depth, hold all or first-time commenters, links before holding, blocked words
  (spam), notification emails.
- **Moderation.** Dashboard → Comments (`cms:comments`, also Editors): status tabs, approve,
  spam, trash, reply; the pending count shows in the navigation. New comments email the site
  and entry author through the `EMAIL` binding when present.
- **Site and API.** `EntryView.comments` (threaded, approved, and the form), rendered by the
  default theme. `GET /api/cms/comments?collection=&entry=` for headless sites.

### Patterns

- **Collection.** A built-in `patterns` collection (private, not publishable): title, rich text
  `content`, `synced` and `starter` (the collections it starts new entries of).
- **Synced patterns** insert a `core/pattern` block that renders the pattern's current
  content, so editing it updates every use. **Unsynced** patterns insert a copy. A synced block
  can be detached into a copy. Patterns are not expanded inside patterns.
- **Starting layouts.** A new entry of a collection with starter patterns offers them.
- **Rendering.** Site pages resolve patterns with a system principal; the content API returns
  them in `patterns`.

### Translations

- **Languages.** Settings → Languages: the site's languages; the first is the default. With
  one language nothing changes.
- **Entries.** `locale` (backfilled to the default when languages are first saved) and
  `translationGroup`. Slugs stay unique per collection.
- **URLs.** The default language has no prefix; others live under `/<code>/` (`/fr/a-propos`,
  `/fr/posts`, `/fr`). Language codes are reserved root slugs.
- **Editor.** A Languages box: the entry's language, and per language Edit or Translate (a
  draft copy in that language and group). Lists get a language column and filter.
- **Site.** Archives, search and feeds list the current language. Menu entry items link to the
  translation in the current language. `hreflang` alternates and a language switcher.
  Terms, menu labels and settings are not translated.
- **API.** `?locale=` and `translations` on entries.

### Stronger sign-in

- **Factors.** TOTP (RFC 6238, 6 digits, 30 s, ±1 step, no reuse of a step), passkeys
  (WebAuthn through SimpleWebAuthn 14) and 10 one-time recovery codes. Primitives live in
  `@cossackframework/auth`; the CMS stores them (`cms_user_security`, `cms_passkeys`,
  `cms_auth_challenges`).
- **Sign-in.** A password with a second factor creates a pending sign-in (5 minutes, 5
  attempts) and `/auth/two-factor` asks for a code. Passkeys sign in directly from the login
  page. `POST /api/auth/session` accepts `code`, else answers `twoFactorRequired`.
- **Profile → Security.** Authenticator app (QR code through `uqr`), recovery codes, passkeys.
  User managers can reset a user's second factors, under the role rule.
- **Enforcement.** A General setting requires a second factor for users who can reach the
  dashboard; they are sent to Profile → Security until they add one.
- **ORM applications** keep password sign-in; their pages hide the controls.

### Dashboard follow-ups (2026-10-17)

- **Client-safe helpers.** Page `render()` code must not call server-only modules (`cms/site.ts`
  imports the server entry): the stub throws in the browser and client navigation stops.
  `languageName` moved to `@cossackframework/cms`.
- **Blocks.** A block type names a Solar `icon` and a `category` (text, media, design,
  widgets, embeds; default widgets). Blocks fields and rich text share a block picker
  grouped by category, with search. Tools → Blocks groups them too.
- **Titles.** A required text field rejects blank text on the server; the editor stops a
  blank title before sending. Move to trash changes only the status.
- **Last sign-in.** Starting a session stamps `cms_users.last_sign_in_at` (host step 6,
  backfilled from sessions), so it survives sign-out. ORM applications read the newest
  auth session, which sign-out removes.
- **Sessions and application passwords.** The user screen gets Profile, Sessions and
  Application passwords tabs. The last two show to the user and administrators (role
  managers) only (`canManageAccess`), and their server methods check again.
- **API tokens stay per user.** No site-wide keys under Settings: a token acts as its user,
  so roles bound it, writes are attributed and removing the user ends it. Integrations get
  their own user with a narrow role; an administrator issues its password from its screen.

## Done when

`packages/cms` live suites cover each area; a generated Node and Workers application pass the
flows in the browser and over HTTP: schedule and auto-publish, preview links, compare and
restore, autosave recovery, slug-change redirects, sitemap and robots, image variants,
token writes and a webhook delivery, a moderated comment, a synced pattern, a translated
page under `/fr/`, and TOTP and passkey sign-in.

## Outcome

| Area | Delivered | Verified by |
| --- | --- | --- |
| CMS package | Statuses, `field.group`, `fieldOrder`, self-applying upgrades, `publishDue`, previews, autosaves, `revision`/`restore`, `diffWords`/`compareRecords`, redirects, API tokens, webhooks, comments, patterns, languages, image variants and edits, `cms.security` | `essentials.test.ts` (14 live cases) and `essentials-unit.test.ts`; the earlier suites |
| Auth package | `two-factor` (TOTP, recovery codes), `passkeys` (SimpleWebAuthn 14), login handlers that answer with their own `Response` | `two-factor.test.ts` (RFC 6238 vectors) |
| Scaffold | Publish box status select, field drag and drop, list avatars and slugs, revisions, preview, sitemaps, robots.txt, SEO head and JSON-LD, Tools → Redirects and Webhooks, Comments, Settings → Languages, Profile → Security, two-step sign-in, image crops, comment form with Turnstile in the default theme | recipe tests; `generated-runtime-cms-essentials.test.js` on Node, Workers and in Chromium (virtual authenticator) |

Findings:

- On Workers every local request has one client address, so the comment throttle applies
  across visitors in tests.
- FastDB rejects FastQL functions inside relational `UPDATE`/`DELETE` subqueries; redirect
  statements are guarded by the write's audit row instead.
- WebAuthn needs a host name: browser tests use `localhost`, not `127.0.0.1`.
- The Images binding's local mode supports only resizing and formats; the transformer
  retries without the crop when the binding refuses it.
