---
title: 'Multisite'
description: 'Run many CMS sites from one application: one database per site, accounts shared across the network, and a network dashboard.'
---

# Multisite

One CMS application can run many sites. Each site has its own RomeDB database, its own
domains, content, settings, roles and members. Accounts are shared: a person signs in once and
reaches every site they are a member of. Every install is a network of one site until you add
a second one, and nothing changes for a single-site install.

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

Sites need a place to keep their databases:

| Runtime | Main database | Added sites |
| --- | --- | --- |
| Node | A file (`ROMEDB_URL=storage/romedb/app.romedb`, the default) | A file per site beside it: `storage/romedb/<uuid>.romedb`. Nothing to set. |
| Node or Workers | A URL (`romedb serve` or RomeDB Cloud) | `ROMEDB_SITES_URL`, a RomeDB Cloud organization URL (or the organization URL of `romedb serve --directory`), and `ROMEDB_SITES_TOKEN`, an organization key with the `manage` and `query` scopes. |

Set `APP_URL` to the network's address, such as `https://example.com`. Sign-in happens on
that host, and new sites start at a subdomain of it.

Without a place for site databases, Network → Sites explains what to set, and the rest of the
dashboard is unchanged.

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
- While the network has only the main site, every host serves it, so preview URLs and
  tunnels keep working.

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

Network admins open `/dashboard/network` on the network host:

- **Home**: counts of sites and accounts.
- **Sites**: every site with its address, members and status. *Add site* asks for a name, an
  address under the network's subdomain, the first administrator's email and optional
  starter content. Row actions: Dashboard, Visit, Edit, Archive, Restore and Delete. A site's
  page manages its name, domains and members.
- **Users**: every account with the sites it belongs to. Make or remove network admins,
  suspend, activate or delete accounts, and add new ones. Deleting an account first removes
  it from every site, through each site's own user deletion.
- **Plugins**: one state per plugin for every site (see below).
- **Themes**: which themes sites may choose. A hidden theme leaves every site's Appearance,
  and a site that used it falls back to another theme.
- **Settings**: the network name and the domain new sites' addresses end with.
- **Updates**: sites with schema steps to apply after a deploy. Each site applies its own
  when it next loads; this page upgrades them now, ten at a time.

Members of more than one site see **My sites** in the dashboard menu and the site taskbar's
Start menu; `/dashboard/my-sites` lists them with their dashboards. Network admins also get a
*Network* link in every site's dashboard taskbar.

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
settings, then the first administrator. If a step fails, calling it again with the same input
resumes after the last finished step.

## Background work

A request runs its own site's maintenance at most once a minute, as on a single site. The
scheduled run (Node's interval, the Workers cron) runs the main site first. It then visits
the added sites in turn, from where the last run stopped, within a 20-second budget. So
scheduled publishing, the outbox, webhooks and write recovery also run on sites nobody visits.

## Limits of this release

- Each process keeps up to 32 site hosts open; the one used longest ago closes first.
- On Node, one process owns the database files. Share a live network with another process,
  such as RomeDB Studio, through `romedb serve --directory storage/romedb`.
- Workers development with several sites needs `ROMEDB_SITES_URL` pointing at a
  `romedb serve --directory` you start yourself; `pnpm dev` starts only the main database's
  service.
