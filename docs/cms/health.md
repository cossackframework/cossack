---
title: 'Health and Traffic'
description: 'The Health page: findings for search and answer engines, crawler visits, missing pages and the search index.'
---

# Health and Traffic

Tools → Health shows how the site stands with search and answer engines: what they fetch, what
visitors miss, and what to fix.

## Findings

A list of checks, warnings first: the site hidden from search engines, no email sender or
`MAIL_FROM`, no AI provider, no `APP_URL`, no publisher logo or profiles, IndexNow off, no cache
purger, crawlers blocked in robots.txt, articles without a summary, entries with nothing to
describe them, cornerstone entries marked noindex, and authors without a bio. Most link to the
setting or entries to fix.

## Crawler visits

The site counts requests by known crawlers, by user agent: search engines (Googlebot, Bingbot
and others) and AI crawlers and fetchers. Browsers and unknown agents are never counted, so a
visitor's page view writes nothing. Each count is one row per day, crawler and kind of page:
`entry`, `archive`, `home`, `term`, `author`, `search`, `markdown`, `llms`, `sitemap`, `robots`,
`feed`, `not-found` or `other`.

The table shows each crawler's total over the period, by kind, and its last day. If an AI search
crawler never appears, check robots.txt (Settings → Crawlers) and the CDN's bot settings. If it
fetches `llms.txt` or Markdown, those are read.

## Missing pages

Every `GET` or `HEAD` to a path that answered 404 is recorded with its hit count and the last
referrer. Probes for other software (`.php`, `wp-*`, `.env`, assets and the like) are skipped.
The list shows the most hit first; **Redirect** makes a redirect for a path, and **Dismiss**
forgets it.

The writes run after the answer is sent (`waitUntil` on Cloudflare), so pages never wait for
them. Server code reaches them through `cms.traffic` (`recordVisit`, `visits`, `recordNotFound`,
`notFound`, `forgetNotFound`).

## Retention

The maintenance run prunes visit rows older than 90 days and missing paths seen fewer than three
times and not hit for 30 days.

## Site search

The Health page also shows how many entries the site search has indexed. **Rebuild** clears the
index and fills it again in the background.
