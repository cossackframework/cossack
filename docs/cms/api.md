---
title: 'Management API, CLI and MCP'
description: 'Manage a CMS site from a terminal or an agent: the management API under /api/cms, the cossack cms commands, and the MCP server every site serves.'
---

# Management API, CLI and MCP

A CMS site has three doors besides its dashboard, and they open with one key. The
**management API** under `/api/cms/` does what the dashboard does: entries, publishing,
revisions, notes, users, roles, settings, terms, media, menus, widget areas and, on a network,
sites. The
**`cossack cms`** commands call it from a terminal or a script. The **MCP server** at
`/api/cms/mcp` offers the same operations as tools to MCP clients such as Claude and Cursor.
All three sign in with an application password and pick a site the same way.

## Signing in

An application password (`cms_<id>.<secret>`) belongs to a user and acts with their roles. Make
one under Profile → Application passwords, or let the CLI make it:

```bash
cossack cms login --url https://example.com
```

The MCP server adds `list_webhooks`, `create_webhook`, `delete_webhook`, `list_comments` and
`moderate_comment` for the same operations.

`import wxr <file>` reads a WordPress export: categories and tags become terms (parents first),
posts and pages become entries (their HTML as a Custom HTML block, plain text as paragraphs;
`--posts` and `--pages` name other collections), nested pages keep their parents, and a permalink
that differs from the new address becomes a redirect. A password-protected post keeps its password;
in a collection without a password field it is imported as a draft, and the report says so. `--dry-run` reports without writing. Attachments and comments are counted and
left: upload the media and update links; comments have no endpoint yet.

`login` asks for the email and password (or reads `CMS_EMAIL` and `CMS_PASSWORD`), takes a
second-factor code with `--code`, signs in, creates an application password named after the
machine (`--name` renames it; `--scope read` makes a read-only one; `--expires 90` ends it after
ninety days), ends the session and keeps
the password in `~/.config/cossack/cms-logins.json`, readable by you alone. `--token cms_…`
stores a password made in the dashboard instead. `cossack cms logout` revokes and forgets it.

| Setting | Comes from, in order |
| --- | --- |
| The address | `--url`, `COSSACK_CMS_URL`, the project's `APP_URL` (`.env` or `.dev.vars`) when the command runs inside one, then the current login. |
| The site | `--site`, `COSSACK_CMS_SITE`, then the login's site. |
| The password | `COSSACK_CMS_TOKEN`, then the login for the address and site, then the address's network login. |

`COSSACK_CMS_URL` and `COSSACK_CMS_TOKEN` alone are enough in CI. A read-only password lists
and reads; writes answer 403.

Credentials go only over HTTPS, or plain HTTP to this machine (`localhost`, `*.localhost`,
`127.x`, `::1`, `0.0.0.0`). For another development host, such as `myapp.test` or a LAN address,
pass `--allow-http` or set `COSSACK_CMS_ALLOW_HTTP=1`. A password, token or recovery code from
the shell goes to an address only the project's `.env` names once `--url` or `COSSACK_CMS_URL`
confirms it. `cossack cms logout` forgets a stored login even where it may not send the
password to revoke it.

## Locked out: recovery mode

An administrator who forgot the password normally uses *Forgot password*, which needs a site
that can send email. Without one, turn on recovery mode by setting `CMS_RECOVERY_CODE` in the
site's environment to a random value of at least 16 characters (`openssl rand -hex 24`; with
`wrangler secret put CMS_RECOVERY_CODE` on Workers, in `.env` on Node), then run:

```bash
cossack cms password reset --email you@example.com              # --url and --site as for any command
cossack cms password reset --email you@example.com --second-factors   # the phone is lost too
```

The CLI takes the code from `CMS_RECOVERY_CODE`, the project's `.env` or `.dev.vars`, or a
prompt, and needs no login. It prints a reset link that works for one hour; the new password is
chosen in the browser, so it never goes through the command line. `--second-factors` also
removes the account's authenticator app, recovery codes and passkeys.

The site answers `POST /api/cms/recovery` (`Authorization: Bearer <code>`, body `{ email,
secondFactors? }`) with `{ email, resetUrl, expiresAt, secondFactorsCleared }`; 403 while the
environment has no code (or one shorter than 16 characters), 401 for a wrong code, 404 for an
email with no active account, 429 after five tries from one address in fifteen minutes. Each
recovery is written to Tools → Activity (`recover-account`, or `recover-account-factors`), the
account gets an email about it when the site can send one, and while the code is set the
dashboard reminds administrators to remove it. A network account resets on the network host.

## Sites of a network

Every command takes `--site <id>` (`main` for the main site). The CLI sends it as an
`X-Cossack-Site` header to the network host, which serves that site under `/api/` while the
network is on, so a site's own address need not resolve from your machine. The MCP endpoint
takes `?site=<id>` in its URL. A network account's password works on every site it belongs
to; a site account signs in with `--site`, and its password works on that site. Requests to a
site's own address keep working as before.

## The CLI

```bash
cossack cms <command> [args] [--url …] [--site …] [--json]
```

| Command | Does |
| --- | --- |
| `login`, `logout`, `whoami`, `mcp` | Sign in and out, show who the password acts as, print an MCP client configuration. |
| `collections list`, `collections schema <collection>` | The content types and their fields; the JSON Schema of one. |
| `entries list <collection>` | Published entries; `--status draft` (or `pending`, `scheduled`, `published`, `trash`, `any`), `--q`, `--term categories:news`, `--filter field=value`, `--locale`, `--page`, `--per-page`, `--format html`. |
| `entries search <words…>` | Search the site as visitors do: published entries of every collection, best first, with snippets; `--collection`, `--locale`, `--page`, `--per-page`. |
| `entries get <collection> <id\|slug>` | One entry, with its `rev`, patterns and translations. |
| `entries create <collection>` | A new entry from `--data '{…}'` (or `@file`, `@-` for stdin) and `--set field=value`. |
| `entries update <collection> <id>` | Change fields; the current revision is read first unless `--rev` is given. |
| `entries publish <collection> <id> [--at <time>]` | Publish now, or schedule at an ISO 8601 time. |
| `entries unpublish`, `entries trash <collection> <id>` | Back to a draft; into the trash. |
| `entries revisions`, `entries revision <collection> <id> <n>`, `entries revert <collection> <id> <n>` | List revisions, read one, restore one. |
| `entries delete <collection> <id> --yes` | Delete permanently. |
| `notes list [<collection> <id>]`, `notes add <collection> <id> --body …`, `notes resolve\|reopen\|edit\|delete <noteId>` | Review notes on an entry, or across the site (`--status open`). `--target field:title` anchors a thread; `--reply-to` replies. |
| `users list\|get\|create\|update\|delete`, `roles list` | Users with `--email`, `--password`, `--name`, `--role` (repeat; the complete list), `--status`. |
| `settings get [group]`, `settings set <group> --set field=value`, `settings export [--out file]`, `settings import --data @file` | Settings by group, or as the document Settings → Export writes. |
| `cache purge [--tag <tag>] [--path <url>]` | Purge the caches in front of the site: every page, or the tags and URLs given (see [Cache](/docs/cms/cache.md)). |
| `taxonomies list`, `terms list\|get\|create\|update\|delete <taxonomy>` | Terms, with `--name`, `--slug`, `--parent`, `--description`. |
| `media list [--q --kind image]`, `media upload <file…>` | The media library. |
| `menus list\|get\|create\|update\|delete` | Navigation menus (the appearance permission): `menus create "Main" --location primary --data '{"items":[…]}'`; `update <id>` takes `--name`, `--data` (the whole items tree) and `--location` (the complete list). |
| `locations list`, `locations set <location> <menuId>`, `locations clear <location>` | The themes' menu locations and the menu shown at each. |
| `areas list\|get <name>`, `areas set <name> --data '{"blocks":[…]}'`, `areas reset <name> --yes` | The themes' widget areas (header, footer, sidebars): their blocks, replaced whole, or forgotten so the theme's defaults show again. |
| `sites list\|get\|create\|archive\|restore\|delete` | A network's sites, for network admins on the network host: `sites create Blog --host blog.example.com [--admin email --language en --no-starter]`. |

`--set` values that are JSON are parsed (`--set menuOrder=3`, `--set featured=true`,
`--set tags='["a"]'`); anything else is text, and `a.b=value` nests. `--data` is exact. Deletes
need `--yes`; nothing prompts. Under `--json` the envelope's `data` is the API's answer, and
failures carry codes such as `COSSACK_CMS_UNAUTHENTICATED`, `COSSACK_CMS_FORBIDDEN`,
`COSSACK_CMS_NOT_FOUND`, `COSSACK_CMS_CONFLICT` (a stale `--rev`), `COSSACK_CMS_INVALID` (with
the fields' problems in the message) and `COSSACK_CMS_LOGIN_REQUIRED`.

```bash
cossack cms entries create posts --set title="Hello" --set status=draft --data @body.json --json
cossack cms entries publish posts 019a… --at 2026-12-01T09:00:00Z
cossack cms notes add posts 019a… --body "Shorter title?" --target field:title
cossack cms settings set general --set siteTitle="My site" --site blog
cossack cms menus create "Main" --location primary --data @menu.json
```

A menu's `items` is a tree; an item names its `kind` (`link`, `entry`, `archive`, `term` or
`heading`), a `label` (empty uses the target's title), its target, and may carry a
`description`, a `panel` (a synced pattern's ID, rendered beside its links) and `children`.
IDs left out are made. A top-level item with heading children or a panel opens as a mega menu
(see [Menus](/docs/cms/menus.md#mega-menus)); `menu.json` for one:

```json
{ "items": [
  { "kind": "link", "label": "Products", "url": "/products", "description": "Everything we make", "panel": "<pattern id>", "children": [
    { "kind": "heading", "label": "By team", "children": [
      { "kind": "link", "label": "Sales", "url": "/sales", "description": "Close deals faster" },
      { "kind": "link", "label": "Support", "url": "/support" } ] },
    { "kind": "heading", "label": "By size", "children": [ { "kind": "link", "label": "Startups", "url": "/startups" } ] } ] },
  { "kind": "archive", "collection": "posts" }
] }
```

The panel's pattern is an entry of the `patterns` collection: `cossack cms entries create
patterns --set title=Promo --set synced=true --data '{"content":[…]}'`. Widget areas take
the same block shapes as content (`{ "_id", "type", "data", "children"? }`); `areas get header`
shows the theme's default blocks with `rev` 0, and `areas set header --data @header.json`
replaces them.

## The MCP server

Each site serves MCP over Streamable HTTP at `POST /api/cms/mcp`, stateless: no sessions, no
server-initiated streams (GET answers 405). It signs in with an application password alone,
`Authorization: Bearer cms_…`; session cookies are refused, and visitors get 401. `cossack cms
mcp` prints the configuration for the current login, and `--format claude` prints the command:

```bash
claude mcp add --transport http cms-example-com "https://example.com/api/cms/mcp" --header "Authorization: Bearer cms_…"
```

```json
{ "mcpServers": { "cms-example-com": { "type": "http", "url": "https://example.com/api/cms/mcp", "headers": { "Authorization": "Bearer cms_…" } } } }
```

The server's instructions tell the model what the site has. Its tools mirror the API: `get_site`
(start here), `list_collections`, `get_collection_schema`, `list_entries`, `search_site`, `get_entry`,
`create_entry`, `update_entry`, `delete_entry`, `publish_entry`, `unpublish_entry`,
`set_entry_status`, `list_revisions`, `get_revision`, `restore_revision`, `list_notes`,
`add_note`, `update_note`, `delete_note`, `list_users`, `get_user`, `create_user`,
`update_user`, `delete_user`, `list_roles`, `get_settings`, `update_settings`, `purge_cache`,
`list_taxonomies`, `list_terms`, `create_term`, `update_term`, `delete_term`, `list_media`,
`list_menus`, `get_menu`, `create_menu`, `update_menu`, `delete_menu`, `list_menu_locations`,
`assign_menu_location`, `list_widget_areas`, `get_widget_area`, `update_widget_area`,
`reset_widget_area`, `list_sites`, `get_network_site`, `create_site` and `set_site_status`. Each carries its input
schema and annotations (`readOnlyHint`, `destructiveHint`). A read-only password sees the
reading tools only. A refusal or a validation problem comes back as an `isError` result with
the API's `code`; wrong arguments are a JSON-RPC `-32602` error. The protocol revisions
2024-11-05 through 2025-11-25 are answered; a known client revision is echoed.

## The API

Everything is JSON under `/api/cms/`. Reads need the entry's read access (visitors read
published entries); writes need a signed-in user: a session with a same-origin request, or an
application password. A CMS refusal answers `{ error, code, fields? }` with its status:
`CMS_UNAUTHENTICATED` 401, `CMS_FORBIDDEN` 403, `CMS_NOT_FOUND` 404, `CMS_CONFLICT` 409,
`CMS_VALIDATION` 422 (400 for a malformed body), `CMS_UNAVAILABLE` 503.

| Method and path | Does |
| --- | --- |
| `GET /me` | The user, roles, permissions, site, password scope and network state. |
| `GET /webhooks`, `POST /webhooks` `{ name, url, events, collections?, active? }`, `DELETE /webhooks/<id>` | Webhooks, for the webhooks permission; the answer to `POST` carries the signing secret once. |
| `GET /comments/queue?status=&q=&page=&perPage=`, `PATCH /comments/<id>` `{ status }`, `DELETE /comments/<id>` | The moderation queue (pending by default), approving, holding, marking as spam, trashing or deleting a comment, for the comments permission. |
| `POST /payments/webhook` | The payments provider's webhook, signed by the provider; a known event becomes `cms.payment.event`. |
| `GET /redirects?q=&page=&perPage=`, `POST /redirects` `{ source, target, status?, note? }` | Redirects, for the redirects permission; `source` is a path, `target` a path or URL, `status` 301, 302, 307, 308 or 410. |
| `GET /me/tokens`, `POST /me/tokens` `{ name, scope, expiresInDays? }`, `DELETE /me/tokens/<id>` | Application passwords; `POST` needs a session (a password cannot make one) and answers the token once; `expiresInDays` (1 to 3650) ends it on its own. |
| `GET /collections`, `GET /schema/<collection>`, `GET /taxonomies` | Content types with fields; a JSON Schema; taxonomies. |
| `GET /search?q=&collection=&locale=&page=&perPage=` | The site's search, as visitors get it: `{ items: [{ collection, id, title, url, snippet }], page, next, loose }`. Every word is required, and the last one is a prefix from two characters (`walr` finds walrus); `loose` is true when nothing had them all and the items have some. Titles rank above the same word in the text. A snippet is plain parts, `{ text, match }`, cut by RomeDB. No total: `next` says another page follows. The site's search box asks it for suggestions (`perPage=5`). |
| `GET /content/<collection>` | Entries: `status`, `q`, `term`, `locale`, `filter[field]`, `page`, `perPage`, `format=html`. With `q`, the first `perPage` matches, without entries locked to the reader (protected, or members-only for a visitor). A filter or `sort` on a field locked entries withhold lists only entries the reader may open; for a signed-in reader who can't edit the collection, it reads at most 1,000 matches, and when there were more the answer has `truncated: true` and its `total` and `pages` cover only those. |
| `POST /content/<collection>` | Create. |
| `GET /content/<collection>/<id\|slug>` | One entry (`?preview=<token>` for a preview link). |
| `GET /content/<collection>/<id\|slug>/blocks/<blockId>` | One block of the entry by its ID (set under Style → Advanced → Block ID), nested blocks and blocks embedded in rich text included, with the field it sits in. |
| `PATCH /content/<collection>/<id>` `{ rev, …fields }` | Change; `rev` (or `If-Match`) is the revision read, else 428; a stale one answers 409. |
| `DELETE /content/<collection>/<id>?rev=` | Delete. |
| `POST …/<id>/publish` `{ at?, rev? }`, `POST …/<id>/unpublish` `{ rev? }` | Publish or schedule (`at` in the future); back to a draft. `rev` left out means the current revision. |
| `GET …/<id>/revisions`, `GET …/<id>/revisions/<n>`, `POST …/<id>/revisions/<n>/restore` | Revisions. |
| `GET …/<id>/notes`, `POST …/<id>/notes`, `PATCH /notes/<noteId>`, `DELETE /notes/<noteId>`, `GET /notes?status=open` | Notes (see [Notes](/docs/cms/notes.md)); the last lists entries with notes across the site. |
| `GET /users`, `POST /users`, `GET\|PATCH\|DELETE /users/<id>`, `GET /roles` | Users (`cms:users`; roles for role managers). |
| `GET /settings`, `PUT /settings`, `GET\|PATCH /settings/<group>` | The settings document and its groups. |
| `POST /cache/purge` `{ tags?, urls? }` | Purge the caches in front of the site (the settings permission): every page, or the tags and URLs given; answers each purger's result. |
| `GET\|POST /terms/<taxonomy>`, `GET\|PATCH\|DELETE /terms/<taxonomy>/<id>` | Terms. |
| `GET /media?q=&kind=`, `POST /media` (multipart `file`) | The media library: `q` matches titles and names, `kind` is image, video, audio, document or archive. |
| `GET\|POST /appearance/menus`, `GET\|PATCH\|DELETE /appearance/menus/<id>` | Menus, for the appearance permission: `{ name, items, locations }`, `rev` on a change. `GET /menus/<location>` is the resolved menu visitors see. |
| `GET /appearance/locations`, `PATCH /appearance/locations/<location>` `{ menu }` | The themes' menu locations and the menu at each (`menu` null for none). |
| `GET /appearance/areas`, `GET\|PUT\|DELETE /appearance/areas/<name>` | Widget areas: `PUT` `{ blocks, rev }` replaces the blocks (`rev` 0 while the theme's defaults show), `DELETE` forgets them. |
| `GET\|POST /network/sites`, `GET\|PATCH /network/sites/<id>` `{ status }` | Sites, for network admins on the network host. |
| `POST /mcp` | The MCP server. |
| `DELETE /api/auth/session` | Ends the session (same-origin), for tools that signed in to make a password. |

In the application, every route calls `src/cms/manage.ts`, and so do the MCP tools in
`src/cms/mcp-tools.ts`: an operation added there is one route and one tool away from both.
