---
title: 'Multisite'
description: 'Run many CMS sites from one application: one database per site, accounts shared across the network, and a network dashboard.'
---

# Multisite

One CMS application can run many sites. Each site has its own RomeDB database, its own
domains, content, settings, roles and members. There are two kinds of accounts. A *network
account* signs in once, on the network host, and reaches every site it is a member of. A
*site account* belongs to one added site, signs in on that site's own address, and lives in
the site's database. The network is off until a network admin turns it on, and nothing
changes for a single-site install.

## How it is organized

| Part | Where it lives |
| --- | --- |
| **Main site** | The first database (`ROMEDB_URL`). It is also the *network database*. |
| **Network accounts** | `cms_accounts` in the network database: email, password hash, status, profile and network role. Their sessions on the network host, second factors, reset tokens and application passwords live there too. |
| **Site accounts** | `cms_accounts` in an added site's own database, with their sessions, second factors, passkeys, reset tokens and application passwords beside them in the same tables. The network database does not list them. |
| **Site registry** | `cms_sites` and `cms_site_domains` in the network database. The main site has no row. |
| **Members** | `cms_users` in each site's database. A member row has the account's ID, a copy of its name, email, avatar and status, and the site's own roles, author slug and profile fields. An email is one member per site, whichever kind its account is. |
| **Everything else** | Collections, entries, terms, menus, settings, files, comments, forms, redirects, webhooks and plugin grants stay in each site's own database. No query spans two databases. |

A **network admin** (`network_admin`, the account that ran setup) has full access to every
site without being a member, and runs the network dashboard. Sites cannot define a role
with that ID. The last active network admin cannot be suspended, demoted or deleted.

## Turning it on

A network admin turns the network on under Settings → Network, on the main site: *Run a
network of sites*. The Network menu and the network dashboard then appear on the main site.
Turning it off again hides them, and the added sites stop answering (a 404) while their
databases and registry rows stay; turning it on again serves them again. Scheduled
maintenance also skips them while the network is off.

Sites need a place to keep their databases:

| Runtime | Main database | Added sites |
| --- | --- | --- |
| Node | A file (`ROMEDB_URL=storage/romedb/app.romedb`, the default) | A file per site beside it: `storage/romedb/<uuid>.romedb`. Nothing to set. |
| Node or Workers | A URL (`romedb serve` or RomeDB Cloud) | `ROMEDB_SITES_URL`, a RomeDB Cloud organization URL (or the organization URL of `romedb serve --directory`), and `ROMEDB_SITES_TOKEN`, an organization key with the `manage` and `query` scopes. |
| Development (`pnpm dev`) with a loopback `ROMEDB_URL` | `romedb serve`, which `pnpm dev` starts | `romedb serve --directory storage/romedb/sites` on the next port, which `pnpm dev` also starts unless `ROMEDB_SITES_URL` is set. |

Set `APP_URL` to the network's address, such as `https://example.com`. Sign-in happens on
that host, and new sites start at a subdomain of it.

Without a place for site databases, Settings → Network and Network → Sites explain what to
set, and the rest of the dashboard is unchanged.

## Addresses

A site answers on host names: a subdomain of the network, such as `blog.example.com`, or a
domain of its own. Point a wildcard DNS record (`*.example.com`) at the application for
subdomains. On Cloudflare, add a wildcard route; for customers' own domains, use Cloudflare
for SaaS.

- A host that no site claims gets a 404, "No site at this address".
- A site has one primary domain. Its other domains are aliases and redirect there with a 301.
- A new domain becomes primary only after a check. The network fetches
  `https://<domain>/.well-known/cossack-site` and must get the site's ID back. Until then it
  shows as *Waiting for DNS*.
- A site's absolute URLs (sitemaps, feeds, emails) come from its primary domain, never from
  the request's `Host` header.
- While the network has only the main site, or is off, every host serves it, so preview URLs
  and tunnels keep working. Off, an added site's domains get the 404.

Subdirectory sites (`example.com/blog`) are not supported.

## Signing in

An added site's own sign-in pages (`/auth/login`, registration, password reset, two-step
codes and passkeys) sign in its **site accounts**. A site account's passkey is bound to the
site's address, and its sessions are ordinary sessions in the site's database.

**Network accounts** sign in only on the network host, so their passkeys work for every site.
For the same reason they add and remove passkeys there: on an added site, the Security page
lists a network account's passkeys and links *Manage passkeys on <network>*, and refuses to
add or remove them. Authenticator apps are not bound to an address, so they change on any site.
The site's sign-in pages link *Network account? Sign in on <network>*, and the site gets its
own session back:

1. `blog.example.com/auth/handoff` (the link) redirects to `example.com/auth/handoff?site=blog&next=/dashboard`.
2. A visitor who is not signed in on the network signs in there as usual, with any method. The
   sign-in page shows the site's name and logo, and *Back to Home* returns to the site. The
   handoff continues afterwards.
3. The network issues a one-use code for that site and session, valid for one minute, and
   redirects to `blog.example.com/auth/handoff?code=…`.
4. The site trades the code for a *child session* in its own database, holding the network
   role at that moment. Later requests to the site read only the site's database. The child
   session ends no later than the network session it came from.

Opening an added site's dashboard without a session there goes through the same steps on its
own, without the click: the site sends the visitor to the network with `auto=1`, and a network
admin, or a member who is signed in on the network, arrives signed in. A visitor the network does
not know, or who is not a member, comes back to the site's own sign-in, and the site does not try
again for five minutes (the `cms_handoff_auto` cookie), so a site account signs in there as before.

A network account's password does not sign in on an added site's own form. *Forgot password*
there sends a member with a network account the network's reset link.

Signing out of any site signs out of the network and of every site the session reached.
A password reset, a suspension, a new network role or deleting the account does the same.
Signing a site account out ends its session on that site only.

"Anyone can register" stays a site setting. Registering on an added site creates a site
account with the site's default role. Registering through the network's sign-in (coming from
a site's network link) creates a network account that is a member of that site only.

## Site accounts and network accounts on a site

- **Created on the site.** An added site's Users → New user creates a site account. Network
  admins add network accounts to a site from Network → Sites → the site, or Network → Users →
  the account.
- **Listed.** A site's Users shows both kinds and marks *Network account*. Network → Users
  lists network accounts only; the site's page under Network → Sites lists its members with a
  *Site account* badge, and Sites counts every member.
- **Changed.** The site's user managers change site accounts fully: profile, password, second
  factors, application passwords, suspension, deletion. A network account's name, email,
  password, second factors and application passwords change only by the person or a network
  admin; the site manages its roles and can remove it, and the account stays.
- **Deleted.** Deleting a site account on its site deletes it with what signs it in.
- **Converted.** On Network → Sites → the site, a network admin makes a member's site account
  a network account (*Make a network account*), or a network account a site account of that
  site (*Make a site account*). The member keeps their ID, so their roles and the content they
  wrote stay theirs, and their password, authenticator app and application passwords move
  with them. Their sessions end, and their passkeys are removed: a passkey works only on the
  address it was made on. A network account becomes a site account only when it belongs to
  that site alone and is not a network admin. A site account becomes a network account only
  when no network account has its email. If a conversion stops between the two databases,
  running it again finishes it.
- **Existing accounts** stay network accounts until converted.

## The network dashboard

Network admins open `/dashboard/network` on the network host, while the network is on:

- **Home**: counts of sites and accounts.
- **Sites**: a list table of every site, the main site first, with its icon (Settings →
  General → Site icon; the network's, the main site's, for a site without one), address,
  members and status; status links (All, Active, Archived, Deleted) and a search filter it. *Add site*,
  a page of its own at `/dashboard/network/sites/new`, asks for a name, an address under the
  network's subdomain, a language, the first administrator's email and optional starter
  content. Row actions: Edit, Dashboard, Visit, Archive, Restore and Delete (after a
  confirmation). A site's page manages its name, domains, members and state. The IDs `main`
  and `new` are reserved; a site named *New* gets the ID `new-site`.
- **Users**: a list table of every network account with the sites it belongs to; All and
  Network admins links and a search filter it. Site accounts are listed on their sites. *Add account* (`/dashboard/network/users/new`) asks for
  a name, an email, a password and whether the account is a network admin. An account's page
  edits its name, email and password (sites' member rows get the new name and email), adds it
  to sites with a role and removes it from them, makes or removes network admins, suspends,
  activates or deletes it. Deleting an account first removes it from every site, through each
  site's own user deletion. Your own account changes only from your profile.
- **Plugins**: one state per plugin for every site (see below).
- **Themes**: which themes sites may choose. A hidden theme leaves every site's Appearance,
  and a site that used it falls back to another theme.
- **Updates**: sites with schema steps to apply after a deploy. Each site applies its own
  when it next loads; this page upgrades them now, ten at a time.

The network's settings are under **Settings → Network** on the main site: whether the network
is on, its name, the domain new sites' addresses end with, what new sites start with (a
theme, plugins to enable, and a language) and how sites export their databases (see below). A default theme or plugin the network hides later
is left out. They save with the page's *Save changes*.

Members of more than one site see **My sites** in the dashboard menu and the site taskbar's
Start menu; `/dashboard/my-sites` lists them with their dashboards. The Network menu and the
taskbar's *Network* link show only on the main site; from another site, network admins reach
it through My sites.

## Plugins across the network

Plugin code ships with the application, so every site has the same plugins. Network →
Plugins gives each one a state:

| State | On every site |
| --- | --- |
| **Network active** | Runs, with the grants a network admin approved when activating it. Each site migrates its schema and stores its field groups when it next loads. Site admins see it as *Network active* and cannot disable it. |
| **Available** (the default) | Each site's admins grant and disable it under Plugins, as on a single site. |
| **Hidden** | Not offered, and inactive whatever the site granted. Its data stays. |

An upgrade that requests more grants stays inactive on every site until a network admin
approves it again (*Approve and keep active*). Network deactivate makes the plugin available
again: each site's own grant applies, so a site that never granted it no longer runs it.
Grants, settings and data stay in each site's database. Other processes see a change within
30 seconds.

## Exporting a site

Every site can download its database as one JSON file under **Tools → Export**, for its
admins (Settings permission) signed in with a session. The main site downloads at once. An
added site follows Settings → Network → *Site exports*:

| Setting | An added site |
| --- | --- |
| **Site admins request an export; a network admin approves it** (the default) | *Request export* records a request. Network admins see it in the main site's taskbar (*Export requests*), as a badge in Network → Sites, and on the site's page, where they approve or decline it. After an approval the site downloads its export for 7 days. |
| **Site admins export their own site** | Tools → Export downloads at once. |

Network admins download any site's export from its page under Network → Sites
(`GET /api/cms/network/sites/<id>/export`); a site downloads its own from
`GET /api/cms/site-export`.

The export comes in two forms: **JSON**, which works everywhere and an import reads, and a
**database file**, which a new install opens directly.

The JSON file, `<site>-<date>.json`, is `{ format: 'cossack-site-export', version: 1, exportedAt,
site, skipped, redacted, tables }`. Each table has its `name`, `model` and `rows`; relational
tables also list their `columns`, and their rows are arrays in that order, while document
tables' rows are whole documents. Values use RomeDB's portable encoding, so `decodeValue`
from `@cossackframework/romedb` restores integers, record IDs and binary values exactly. Rows
are read in key order, a page at a time. Sessions, sign-in challenges, reset tokens, second
factors, passkeys, application passwords, preview links, handoffs, the cache and the
network's own tables (accounts, the site registry) stay out, and webhook secrets are null.
Media files are not included; `cms_files` rows name their storage keys. The CMS's own tables
come first, then the collections' (`r__cms__posts` and the rest), so an import has the
collections' definitions before their records. In code, `siteExport(host.db, { site })` from
`@cossackframework/cms/server` yields the same document as text chunks.

The database file, `<site>-<date>.romedb`, is the whole database at one moment, taken while
the site keeps running, on every runtime (`?format=romedb` on either address, *Download
database file* in the dashboard). Use it for sites too large to import.

- **It keeps** the site's content, settings and members, and its own accounts with their
  password hashes, passkeys and application passwords (stored as digests). Keep it private.
- **It leaves out** sessions, sign-in challenges, reset tokens, preview links, handoffs and the
  cache, authenticator apps and recovery codes (their secrets would make valid codes, so
  accounts set them up again), plus webhooks and pending work (the outbox, webhook deliveries,
  background jobs).
  RomeDB never reads these tables into the copy, so no part of the file holds their rows. Set
  up webhooks again after the move. Media files are not included.
- **The main site's file** is the network's database, with every network account, so only
  network admins download it. Its other admins get the JSON export.
- **It is a new database,** with its own RomeDB identity. Point `ROMEDB_URL` at it, run
  `romedb serve FILE`, or start `romedb serve --directory` with it in the folder under any
  `<id>.romedb` name. RomeDB Cloud imports it as a new database.

RomeDB builds one copy of a database at a time; a second download at that moment is told to
try again. With a database file or `romedb serve`, the disk beside the database needs room for
one more copy while it is built. RomeDB Cloud builds one copy at a time across the service,
and the file must start arriving within 120 seconds. A site too large for that is told to
download the JSON export.

## Importing an export

An export fills a new site: on a fresh install, or as a site added to a network.

- **A new install.** `/auth/setup` offers *Moving a site here? Start from its export*: the
  setup code and the file. Then *Take over this site* follows, as in the next section.
- **A network.** Add the site with *Add starter content* off. While it has no entries and no
  site accounts, its page under Network → Sites shows *Import an export*.

The browser sends the file itself as the request body, so the server reads it as a stream,
a row at a time; without JavaScript the form uploads it. What happens:

- The site's schema is applied, then each CMS table in the export replaces the site's: its
  settings, roles, members, menus, taxonomies, revisions and the rest. The imported collections
  then get their tables, and their records come in with their IDs.
- The site keeps its own schema ledgers and leaves the export's pending work behind (the
  outbox, webhook deliveries, background jobs), so nothing is sent twice. Webhooks arrive turned
  off, with new secrets, since exports leave the secrets out.
- Members whose ID is a network account of this network stay network accounts. On an added
  site, the others get site accounts without passwords, and set them with *Forgot password*.
  On a new install they wait for the takeover. Network members who were on the site before the
  import, such as the admin who added it, stay members.
- A table the export has but this install does not, such as a plugin's that is not installed,
  is left out, and the page says so. A table this install has with columns the export lacks
  imports when those columns have defaults. An export with columns this install lacks comes
  from a newer CMS: update first.
- If an import stops partway, the site shows it, and importing again starts over. Two imports
  of one site do not run at once.
- Media files are not in exports: copy the storage separately.

In code, `siteImport(host, stream)` from `@cossackframework/cms/server` imports and reports what
it imported; `siteImportState(host)` says whether a site can take one (`new`, `stopped`,
`running` or `used`).

## Moving a site to its own install

A site's database can run on its own, as the main database of a new install (`ROMEDB_URL`
pointing at the file, or at `romedb serve FILE`). It has the site's content, settings,
roles, members and site accounts, but not the network accounts of its members, which stay in
the network database. On the first
visit, `/auth/setup` sees that no network admin exists and offers **Take over this site**:
with the setup code, one of the site's administrators enters their email and a new password.
The administrator's account gets the new password and becomes the install's network admin.
Site accounts keep their passwords: they were the site's all along. Members with a network
account get an account without a password, recorded as a member of the new install, and set
one with *Forgot password*, or the administrator sets it under Users. Sessions copied with the
database end. Media files move separately: the new install's storage needs the site's
files (on the network they are under `sites/<id>/`).

To get there, download the site's database file and point `ROMEDB_URL` at it, or import the
site's JSON export into the new install (above). Site accounts keep their passwords only with
the database file; a JSON import gives them accounts without passwords.

## Site states

| State | Visitors | Members |
| --- | --- | --- |
| Active | See the site | Use the dashboard |
| Archived | Get a 503, "This site is archived" | Can still open the dashboard |
| Deleted | Get a 404 | Nothing; a network admin can restore it for 30 days |

Thirty days after deletion, scheduled maintenance deletes the site's media, its database
and its registry rows. The main site cannot be archived or deleted.

## Creating a site in code

```ts
import { networkFor } from './cms/index';

const network = networkFor(env);
const site = await network.createSite(
    { name: 'Blog', host: 'blog.example.com', admin: accountId, starter: true },
    { principal }, // a network admin
);
```

`createSite` records each step it finishes: the database, the schema, the default roles and
settings (with the network's default theme, plugins and language, or `language` when given),
then the first administrator. If a step fails, calling it again with the same input
resumes after the last finished step.

## Background work

A request runs its own site's maintenance at most once a minute, as on a single site. The
scheduled run (Node's interval, the Workers cron) runs the main site first. It then visits
the added sites in turn, from where the last run stopped, within a 20-second budget. So
scheduled publishing, the outbox, webhooks and write recovery also run on sites nobody visits.

## Limits of this release

- The CMS needs RomeDB 0.2.21 or later, and refuses an older engine at connect. Databases from
  RomeDB 0.2.12 or earlier that hold documents do not open: export them as JSON on the old
  release first, or start new ones.
- Each process keeps up to 32 site hosts open; the one used longest ago closes first.
- An import runs in one request. On Workers, the request's CPU limit bounds how large a site
  imports; on Node it is bounded by time only.
- On Node, one process owns the database files. To share a live network with another
  process, such as RomeDB Studio, run it over services instead: `ROMEDB_URL` at `romedb serve`
  and `ROMEDB_SITES_URL` at `romedb serve --directory`, as `pnpm dev` does for a loopback URL.
- In development, the main site answers only on `APP_URL`'s host once the network has added
  sites. Open the dashboard at that address, such as `http://localhost:5173`.
