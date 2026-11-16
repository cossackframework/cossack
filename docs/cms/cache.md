---
title: 'CMS Cache'
description: 'What the site tells the caches in front of it, how changes purge Cloudflare or another CDN, and the Cache tool.'
---

# CMS Cache

The CMS keeps no HTML cache of its own. The cache in front of the site holds the pages:
Cloudflare with one cache rule, another CDN, or a reverse proxy before a Node deployment. The
CMS makes that correct in two ways: every anonymous response says how long it may be held and
what it shows, and every change purges the pages it touched.

## What the site sends

An anonymous page, feed, sitemap, `robots.txt`, `llms.txt` and the web manifest answer with:

```http
Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=60
Cache-Tag: cms:main,cms:main:c:posts,cms:main:e:posts:0193…
```

`max-age=0` keeps browsers revalidating, so a purge reaches them at once; `s-maxage` is how
long a shared cache may hold the page. Settings → Cache → *Hold pages* picks it: automatic
(five minutes, or a day once a purger is configured), none, a minute, an hour, a day or a
week. A not-found page is held a minute at most.

Responses that depend on who asks are never held: a signed-in user's pages (they carry the
taskbar and may hold a draft), Live Edit, preview links, password-protected entries whether
locked or unlocked (the unlocked page depends on a cookie that shared caches ignore), and pages
of a theme whose options bind to the user. Markdown chosen with `Accept: text/markdown` is not
held either, because caches key HTML by URL and ignore `Vary`; `?format=md` is the address to
cache and to link, and the one the page's `rel=alternate` names.

Tags name what a page shows. Every page carries the site's tag, `cms:<site>` (`main`, or a
network site's ID). An entry's page carries `cms:<site>:e:<collection>:<id>` and
`cms:<site>:c:<collection>`; the lists of a collection (the home page, archives, feeds, term
and author archives, search) carry `c:` tags for the collections they list, as does a page
whose blocks or widget areas hold a *Latest entries* block; a term archive carries
`cms:<site>:t:<taxonomy>:<slug>`.

## What purges what

| Change | Purges |
| --- | --- |
| An entry published, changed while published, unpublished, trashed or deleted; a scheduled entry going live | its entry tag, its collection tag, its URL and its `?format=md` address |
| An entry a menu item links to | every page (the menu shows on every page) |
| A comment approved, edited or removed | the entry's tag |
| Settings, menus, widget areas, the theme or its options, plugins granted or revoked, patterns, forms, terms, redirects, a media file's details or deletion | every page |
| Tools → Cache → *Purge everything*, `POST /api/cms/cache/purge`, `cossack cms cache purge`, the `purge_cache` MCP tool | every page, or the tags and URLs given |

Drafts and private collections purge nothing. A new media file purges nothing: it shows on no
page until a write that does. A plugin's own resources purge nothing; a plugin that shows them
on the site queues its own purge with `cms.purge.queue(reason, { tags, urls })`.

Purges ride the outbox like webhooks and IndexNow pings: a change queues a `CachePurgeEvent`
(`tags`, `urls`, `reason`), the dispatcher runs the `cms.cache.purge` action after the
request, and a purger that fails retries with backoff, each on its own.

## Cloudflare

Add one cache rule for the site's hostname: cache eligible for everything, with the edge TTL
"use cache-control header if present, bypass cache if not". HTML is then held as the headers
say, personal responses pass through, and `Cache-Tag` headers make purging by tag possible on
every plan.

Then give the application a token so changes purge the zone:

| Variable | Does |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | An API token with *Zone → Cache Purge*, and *Zone → Zone Read* unless the zone ID is given. Set it in `.dev.vars` or as a Worker secret; the Node adapter reads it from `.env`. |
| `CLOUDFLARE_ZONE_ID` | The zone to purge. Without it, the zone is looked up by each site's host and its parent domains, and remembered for a day. A network with sites on several zones needs only the token. |
| `CLOUDFLARE_API_URL` | The API's base URL, for tests. |

With a token, *Hold pages* set to automatic holds pages for a day: the purge, not the hold, is
what shows a change. Purges go by tag, thirty per request, and by URL. A 429 or a 5xx retries
through the outbox; a refusal such as a bad token is recorded and dropped, and Tools → Cache
shows it.

Behind a cache, Tools → Health counts only the crawler requests the cache passes on.

## Another CDN, or a proxy

A plugin purges another cache by handling the `cms.cache.purge` action: list the point under
`hooks` in its manifest and add a handler in `server.ts`. The event names the site and carries
the tags and the absolute URLs; throw to retry (the outbox backs off and tries again), or
return after recording a refusal.

```ts
import { cachePurge } from '@cossackframework/cms';
import type { PluginContext } from '@cossackframework/cms/server';

export function register(context: PluginContext) {
  context.hooks.addAction(cachePurge, async event => {
    const response = await context.fetch('https://api.example-cdn.com/purge', { method: 'POST', body: JSON.stringify({ tags: event.tags, urls: event.urls }) });
    if (response.status === 429 || response.status >= 500) throw new Error(`The CDN answered ${response.status}.`);
  });
}
```

An application can also pass purgers to `createCMS({ purgers })`: objects with a `name` and
`purge(event, { cache, signal })`, which is how the Cloudflare purger is added.

A reverse proxy before a Node deployment (nginx, Varnish, Caddy) honors the same headers;
purge it from such a handler, or with `cossack cms cache purge` after a deploy.

## The Cache tool

Tools → Cache shows the hold in force, the purgers (the application's and the plugins'), the
last twenty purges run from this process with their result, and *Purge everything*, for a
change made outside the CMS, such as a deploy. The same purge is `POST /api/cms/cache/purge`
with `{ tags?, urls? }` (the settings permission), `cossack cms cache purge [--tag …] [--path
<url>]`, and the `purge_cache` MCP tool.
