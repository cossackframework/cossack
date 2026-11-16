# Cache: what the site tells the caches in front of it, and when it purges them

The framework has a server-side cache (`specs/cache.md`) and static publishing. The question
for the CMS was whether to add an HTML cache of its own or leave caching to Cloudflare, where
"cache everything, purge on demand" is one rule away. Before this work the site sent no
`Cache-Control` on anonymous HTML, so a cache-everything rule held pages for Cloudflare's
default two hours, and two routes would have leaked behind it.

## Decisions

- **No HTML cache in the CMS.** Cloudflare's cache, or any CDN or reverse proxy, holds the
  pages. A copy inside the Worker would add little: the Cache API is per data center and a
  global purge still goes through the zone API. What the CMS owns is correctness: the headers
  that let a cache hold a page, and the purge when the page changes.
- **Anonymous pages say how long they may be held.** `Cache-Control: public, max-age=0,
  s-maxage=<hold>, stale-while-revalidate=60` plus `Cache-Tag`. `max-age=0` keeps browsers
  revalidating, so a purge reaches them at once; `s-maxage` is for the shared cache. Settings →
  Cache → *Hold pages* picks the hold: automatic (five minutes, or a day once a purger is
  configured), none, a minute, an hour, a day, a week. Not-found pages are held a minute. Feeds,
  sitemaps, robots.txt, llms.txt and the manifest follow the same policy. Personal responses
  (a signed-in user's page, Live Edit, previews, a user-bound theme) keep `private, no-store`.
- **Tags name what a page shows.** Every page carries `cms:<site>`; an entry's page carries
  `cms:<site>:e:<collection>:<id>` and `cms:<site>:c:<collection>`; lists of a collection (home,
  archives, feeds, term and author archives, search) carry `c:` for the collections they list;
  term archives also `cms:<site>:t:<taxonomy>:<slug>`. A zone may serve several sites of a
  network under one domain, so the site is in every tag.
- **Purges ride the outbox.** A change queues a `CachePurgeEvent` (`tags`, `urls`, `reason`)
  as an outbox row of topic `cache.purge`; the dispatcher runs the `cms.cache.purge` action,
  whose handlers are purgers. Failures retry per handler like webhooks and IndexNow. What
  purges what:

  | Change | Purges |
  | --- | --- |
  | An entry published, changed while published, unpublished, trashed, deleted; a scheduled one going live | its entry tag, its collection tag, its URL and `?format=md` |
  | A comment approved, edited or removed | the entry's tag |
  | Settings, menus, widget areas, the theme, theme options, plugins granted or revoked, patterns, forms, terms, a media file's details, redirects | the site tag |
  | Tools → Cache → Purge everything, `POST /api/cms/cache/purge`, `cossack cms cache purge`, `purge_cache` | the site tag, or the tags and URLs given |

  Drafts and private collections purge nothing. A new media file purges nothing: it shows on
  no page until a write that does. Aliases redirect to the primary domain, so only that host's
  cache holds pages.
- **A Cloudflare purger is built in; others are plugins.** `createCMS({ purgers })` takes
  objects with `name` and `purge(event, { cache })`; the application adds the Cloudflare one
  when `CLOUDFLARE_API_TOKEN` is set (Zone → Cache Purge and Zone → Zone Read). The zone is
  `CLOUDFLARE_ZONE_ID`, or looked up by the site's host and its parent domains and remembered
  for a day in `cms_cache`; `CLOUDFLARE_API_URL` points tests at a stub. Purges go by tag,
  thirty per request, and by URL; a 429 or 5xx throws so the outbox retries, a 4xx is recorded
  (Tools → Cache shows the last twenty) and not retried. A plugin purges another CDN by adding
  an action handler for `cms.cache.purge`.
- **Two leaks closed.** A password-protected entry is `private, no-store` whether locked or
  unlocked: the unlocked page depends on a cookie that shared caches ignore. Markdown chosen by
  `Accept: text/markdown` is `no-store`, because caches key HTML by URL and ignore `Vary`;
  `?format=md` is the address to cache and link, and the one `rel=alternate` already names.
- **Not built.** A render cache in the Worker or Node process (the framework's `cache` facade
  could hold pages for a Node deployment without a CDN; the headers above let any proxy do it
  instead). Crawler counts on Tools → Health see only cache misses once a cache is in front;
  the page says so.

## Order

1. Headers: `cacheControl`, `cacheTags`, the `cache` settings group, headers on the site
   routes, the two leak fixes.
2. Purging: `CachePurgeEvent`, `cms.cache.purge`, the outbox topic, `CmsPurge` on the host
   (resource events, settings, menus, areas, redirects, comments, terms, grants), the
   Cloudflare purger, the application wiring.
3. Tools → Cache (status, purge, recent), the API operation, CLI and MCP tool, docs, tests.

## Done when

- A visitor's entry page answers `public, max-age=0, s-maxage=300, stale-while-revalidate=60`
  with the site, collection and entry tags; the same page for a signed-in editor, an unlocked
  protected entry and negotiated Markdown answer `private, no-store`; `?format=md` is public.
- Publishing an entry with `CLOUDFLARE_API_TOKEN` set sends one purge with its tags to the
  zone; changing a setting sends the site tag; a plugin's handler sees the same events.
- The outbox retries a purge that answered 429 and gives up on a 403, which Tools → Cache shows.

## Outcome

| Area | Delivered | Verified by |
| --- | --- | --- |
| Headers (2026-11-07) | `cacheControl`, `cacheHoldSeconds`, `cacheTags`, `cacheTagHeader` (`src/cache.ts`), the `cache` settings group (`hold`), the application's `cms/cache.ts` (`cacheHeaders`, `applyCacheHeaders`, `listedCollections`) on the catch-all page (entry, lists, term, search, 404 held a minute), the layout's area tags (`cms.cacheTags`), feed, sitemaps, robots.txt, llms.txt and the manifest; protected entries `private, no-store` locked or unlocked; negotiated Markdown `no-store`, `?format=md` public | `cache-unit.test.ts`, `app/tests/cache-headers.test.ts`, `generated-runtime-cms-essentials.test.js` (headers on a post, the home page, the feed and a 404; the unlocked protected page, negotiated Markdown and an editor's page private) |
| Purging (2026-11-07) | `CachePurgeEvent` and `cachePurge` (`cms.cache.purge`), the outbox topic `cache.purge` with `Outbox.enqueue` and rounds for rows handlers queue, `CmsPurge` on the host (`queue`, `everything`, `tag`, `recent`, `configured`), `#queuePurge` for resource events (menus naming the entry purge the site), `changed` callbacks of settings, menus, areas, redirects, comments, terms and files, grants; `cloudflarePurger` (`zoneCandidates`, zone lookups remembered in `cms_cache`, thirty per request, `PurgeError` retry or refusal), `createCMS({ purgers })`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_URL` | `cache.test.ts` (entry, settings, menu, redirect, term, menu-named entry, approved comment; a plugin's handler; retry and refusal records), `cache-unit.test.ts` (the Cloudflare purger against a fake API), `generated-runtime-cms-essentials.test.js` (a published post and a setting purge a Cloudflare stub), `generated-runtime-cms-plugins.test.js` (the fixture plugin's `cms.cache.purge` handler sees the purge) |
| Tools and docs (2026-11-07) | Tools → Cache (hold, purgers, recent purges, Purge everything), `POST /api/cms/cache/purge`, `cossack cms cache purge [--tag] [--path]`, the `purge_cache` MCP tool; `docs/cms/cache.md`, rows in `hooks.md`, `api.md`, `deployment.md`, the docs index | `cms-command.test.js`, `generated-runtime-cms-essentials.test.js` (the tool page, the button, the API) |
