---
title: 'Multisite'
description: 'Run many CMS sites from one application: one database per site, accounts shared across the network, and a network dashboard.'
---

# Multisite

One CMS application can run many sites. Each site has its own RomeDB database, its own
domains, content, settings, roles and members. Accounts are shared: a person signs in once and
reaches every site they are a member of. The network is off until a network admin turns it
on, and nothing changes for a single-site install.

## How it is organized

| Part | Where it lives |
| --- | --- |
| **Main site** | The first database (`ROMEDB_URL`). It is also the *network database*. |
| **Accounts** | `cms_accounts` in the network database: email, password hash, status, profile and network role. Sessions, second factors, reset tokens and application passwords belong to the account and live there too. |
| **Site registry** | `cms_sites` and `cms_site_domains` in the network database. The main site has no row. |
| **Members** | `cms_users` in each site's database. A member row has the account's ID, a copy of its name, email, avatar and status, and the site's own roles, author slug and profile fields. |
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
| Development (`pnpm dev`) with a loopback `ROMEDB_URL` | `romedb serve`, which `pnpm dev` starts | `romedb serve --directory storage/romedb/sites` on the next port, which `pnpm dev` also starts unless `ROMEDB_SITES_URL` is set. It needs RomeDB 0.2.12 or later. |

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

Login, registration, password reset, two-step sign-in and passkeys happen only on the
network host, so a passkey works for every site. A site sends visitors there and gets its
own session back:

1. `blog.example.com/auth/login` redirects to `example.com/auth/handoff?site=blog&next=/dashboard`.
2. A visitor who is not signed in on the network signs in there as usual, with any method. The
   sign-in page shows the site's name and logo, and *Back to Home* returns to the site. The
   handoff continues afterwards.
3. The network issues a one-use code for that site and session, valid for one minute, and
   redirects to `blog.example.com/auth/handoff?code=…`.
4. The site trades the code for a *child session* in its own database, holding the network
   role at that moment. Later requests to the site read only the site's database. The child
   session ends no later than the network session it came from.

Signing out of any site signs out of the network and of every site the session reached.
A password reset, a suspension, a new network role or deleting the account does the same.

"Anyone can register" stays a site setting. Registering from a site's sign-in creates an
account that is a member of that site only, with that site's default role.

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
- **Users**: a list table of every account with the sites it belongs to; All and Network
  admins links and a search filter it. *Add account* (`/dashboard/network/users/new`) asks for
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

The file, `<site>-<date>.json`, is `{ format: 'cossack-site-export', version: 1, exportedAt,
site, skipped, redacted, tables }`. Each table has its `name`, `model` and `rows`; relational
tables also list their `columns`, and their rows are arrays in that order, while document
tables' rows are whole documents. Values use RomeDB's portable encoding, so `decodeValue`
from `@cossackframework/romedb` restores integers, record IDs and binary values exactly. Rows
are read in key order, a page at a time. Sessions, sign-in challenges, reset tokens, second
factors, passkeys, application passwords, preview links, handoffs, the cache and the
network's own tables (accounts, the site registry) stay out, and webhook secrets are null.
Media files are not included; `cms_files` rows name their storage keys. There is no JSON
import; to run a site on its own, see the next section. In code, `siteExport(host.db, { site })` from `@cossackframework/cms/server` yields the
same document as text chunks.

## Moving a site to its own install

A site's database can run on its own, as the main database of a new install (`ROMEDB_URL`
pointing at the file, or at `romedb serve FILE`). It has the site's content, settings,
roles and members, but not their accounts, which stay in the network database. On the first
visit, `/auth/setup` sees members without accounts and offers **Take over this site**: with
the setup code, one of the site's administrators enters their email and a new password. Every
member then gets an account without a password, recorded as a member of the new install; the
administrator's has the new password and is its network admin. Sessions copied with the
database end. Other members set a password with *Forgot password*, or the administrator sets
one under Users. Media files move separately: the new install's storage needs the site's
files (on the network they are under `sites/<id>/`).

The export above is JSON for now. A `.romedb` export, a file the new install opens
directly, needs RomeDB to copy an open database (requested from RomeDB as R2). Until then,
with the application stopped (one process owns the files), the RomeDB CLI copies a site's
file: `echo "VACUUM INTO 'blog.romedb';" | romedb storage/romedb/sites/<database>.romedb`, where
`<database>` is the site's database ID from the registry. The copy is one file.

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

- Each process keeps up to 32 site hosts open; the one used longest ago closes first.
- On Node, one process owns the database files. To share a live network with another
  process, such as RomeDB Studio, run it over services instead: `ROMEDB_URL` at `romedb serve`
  and `ROMEDB_SITES_URL` at `romedb serve --directory`, as `pnpm dev` does for a loopback URL.
- In development, the main site answers only on `APP_URL`'s host once the network has added
  sites. Open the dashboard at that address, such as `http://localhost:5173`.
