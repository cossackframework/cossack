# CMS SEO, AEO and GEO

Plan for growing the CMS's SEO from the [essentials](cms-essentials.md) baseline into a Yoast-class
feature set, plus Answer Engine Optimization (AEO: AI Overviews, AI Mode, Copilot, Perplexity
answers) and Generative Engine Optimization (GEO: being cited by ChatGPT, Claude, Gemini).
Written 2026-10-30; implemented the same day on `cms-foundation`. See [Outcome](#outcome).

## What we have

Per-entry `seo` group (title, description, social image, canonical, noindex) with a search-result
preview; `<title>` with a separator; Open Graph and Twitter card; canonical; hreflang;
JSON-LD (`WebSite` + `SearchAction`, `BlogPosting` for the `posts` collection by name, `WebPage`,
`BreadcrumbList` for nested entries, `CollectionPage`); sitemap index with entry, term and static
sitemaps with `lastmod` and images; robots.txt with extra rules; automatic and managed redirects;
RSS feed; responsive images; `reading.discourageSearchEngines`.

Gaps that shape everything below: the schema type is tied to a collection *name*, not a setting;
authors are a bare `name`; there is no site-wide Organization/Person; robots control stops at
`noindex`; nothing tells the engines that content changed; nothing measures anything.

## Ground truth, October 2026

- Google: pages appear in AI Overviews and AI Mode when they are indexed and snippet-eligible.
  "No new machine readable files, AI text files, or markup" and "no special schema.org structured
  data" are needed. Controls are `robots.txt`, `noindex`, `nosnippet`, `data-nosnippet`,
  `max-snippet` and `Google-Extended` ([source](https://developers.google.com/search/docs/appearance/ai-features)).
- Retired rich results: HowTo (2023), sitelinks search box (Nov 2024), seven minor types (2025),
  FAQ (May 2026). The markup stays valid schema.org but earns nothing. Our `SearchAction` is dead
  weight.
- `llms.txt`: no AI vendor has committed to it, Google says it does nothing, SE Ranking found no
  citation correlation across 300k domains. Microsoft and OpenAI crawlers do fetch it. Cheap, so
  we ship it, but it is not where effort goes.
- Cloudflare `Content-Signal` in robots.txt: a preference line, ignored by Google and Bing; real
  enforcement is Cloudflare's bot rules. Cloudflare blocks AI training crawlers on new zones by
  default since Sept 2026, so a misconfigured zone can also hide a site from AI search.
- Bing: `IndexNow` pings are tied to fresher Copilot answers; Bing Webmaster Tools has an AI
  Performance report. ChatGPT search is built on Bing's index, so Bing is the GEO back door.
- The Princeton GEO study: citations, statistics and quotations raise visibility in generated
  answers; keyword density does nothing or hurts. Treat vendor "N% of citations" numbers as noise.
- Yoast 28.x is going the same way: Schema Aggregation for NLWeb, llms.txt, bot blocker, Abilities
  for agents, AI Brand Insights, AI Generate. Its editor analysis is still a keyphrase traffic light.

## Yoast features worth having today, by impact

Impact is for a site's search and answer-engine visibility in 2026, not Yoast's popularity.
Status: **have**, **partial**, **missing**.

| # | Feature | Status | What we do |
| --- | --- | --- | --- |
| 1 | Structured data graph: Organization/Person site representation (logo, `sameAs`), `Article` → `Person` author → `WebPage` → `WebSite`, linked by `@id` | partial | Settings → SEO → Site representation; authors become `Person` nodes with a profile URL; one graph per page |
| 2 | Schema type per content type (Article, NewsArticle, Product, Event, Recipe, Person, Organization, LocalBusiness, VideoObject, WebPage, none) | missing | A `schema` setting on the collection with a field mapping, replacing the `posts` name check. Covers Yoast's Local, Video and News add-ons as types, not add-ons |
| 3 | Robots meta per collection, archive, taxonomy and search: `noindex`, `nofollow`, `max-snippet`, `max-image-preview:large`, `nosnippet`; plus `data-nosnippet` on a block | partial | Collection manager and taxonomy settings get a Robots section; `max-image-preview:large` default on; entry box gets snippet controls |
| 4 | Title and description templates per collection and archive (`%title% %sep% %site%`, `%term%`, `%page%`) | missing | Templates in the collection manager and Settings → SEO; the entry box shows the resolved fallback |
| 5 | Redirect manager extras: 410, regex, CSV import/export, 404 log with one-click redirect | partial | Tools → Redirects grows a 404 log (count, last seen) and types |
| 6 | Internal linking: suggestions while writing, orphaned content report, cornerstone flag | missing | Server-side related-entry search by title/terms/text; a Links report (orphans, cornerstone with few inlinks) |
| 7 | Breadcrumbs everywhere: visible block or theme helper, primary term for posts, JSON-LD on all site pages | partial | `primaryTerm` per taxonomy with a primary flag; breadcrumb list for flat collections via primary term |
| 8 | Canonical hygiene: host and trailing-slash normalization, paginated archives canonical to themselves, UTM stripping | partial | Site middleware redirects to the configured host/slash form; archives get page-aware canonicals |
| 9 | IndexNow on publish, update, delete and redirect | missing | Settings toggle, key file at `/<key>.txt`, queued through the outbox |
| 10 | Social previews in the editor; separate social title/description; `og:image` size and alt; `twitter:site` | partial | Entry box tabs: Search, Social; image dimensions from the media record |
| 11 | Content analysis, slimmed: title/description length, slug, one H1, heading order, image alt, internal and outbound links, paragraph and sentence length, reading ease | partial (counters only) | Deterministic checks in the editor sidebar; no keyphrase density, no traffic light nagging |
| 12 | Bot control for AI crawlers (GPTBot, ClaudeBot, Google-Extended, CCBot, Applebot-Extended, Bytespider, meta-externalagent) | missing | See AEO plan A: purpose-based groups, not a raw list |
| 13 | Bulk editor for titles and descriptions | missing | A table view in the content list with inline edit of `seo.title` and `seo.description` |
| 14 | SEO dashboard and task list: entries without description, noindexed published entries, orphans, broken redirects | missing | One Health page, computed on request |
| 15 | Front-end SEO inspector | missing | Admin bar panel on the site shows the resolved head and JSON-LD; the entry editor's preview can link to it |
| 16 | AI Generate titles, descriptions, alt text, summaries | missing | Optional, through a configured provider; every suggestion needs approval |
| 17 | `llms.txt` | missing | Generated from cornerstone entries, collections and manual picks; weekly regeneration not needed, it is a route |
| 18 | Schema aggregation / NLWeb schema feeds | missing | Watch. A `/schema.json` graph of the site is a day's work once #1 and #2 exist; no evidence it is read yet |
| 19 | Estimated reading time, inclusive language, Semrush/Wincher/Elementor/Algolia/Site Kit, Google Docs add-on | missing | Not planned |

Obsolete or harmful, not building: meta keywords; keyphrase density and duplicate-keyphrase
checks; `rel=next/prev`; noindex on paginated archives; FAQ and HowTo *rich-result* schema
(the content shape matters, see AEO plan B); sitelinks `SearchAction` (remove it, keep `WebSite`
for the site name); sitemap pinging (Google dropped it in 2023, IndexNow replaces it for Bing);
attachment-page redirects (we have no attachment pages); WordPress crawl cleanup (emoji, oEmbed,
shortlinks: nothing to clean here).

## AEO and GEO plan

The honest frame: AEO and GEO are classic SEO plus three things engines now reward: content that
answers in the first paragraph and carries sources, entities the engines can resolve (who wrote
this, which organization), and access and freshness signals for AI crawlers. Everything below is
measurable or cheap; nothing promises placement.

### A. Crawler access by purpose

- **Settings → SEO → Crawlers.** Four groups, each allow/block: *Search engines* (Googlebot,
  Bingbot, Applebot, DuckDuckBot, Yandex), *AI search and answers* (OAI-SearchBot,
  Claude-SearchBot, PerplexityBot, Google-Extended for grounding is not separable, note it),
  *AI training* (GPTBot, ClaudeBot, Google-Extended, CCBot, Applebot-Extended, Bytespider,
  meta-externalagent, Amazonbot), *User-initiated fetchers* (ChatGPT-User, Claude-User,
  Perplexity-User; cannot be blocked by robots.txt, shown for information). Default: everything
  allowed except training is the site owner's call; we default training to allowed with a one-line
  explanation, because blocking training also blocks some grounding.
- **robots.txt** renders the groups; an optional `Content-Signal:` line mirrors them (off by
  default, labelled as a preference Cloudflare reads). The bot list ships as data in the package
  and is updated with releases.
- **Snippet controls.** Entry box: `max-snippet` (default unlimited), `nosnippet`, Bing's
  `noarchive`. Block editor: an "Exclude from snippets" toggle wraps a block in `data-nosnippet`.
- **CDN check.** Health page warns when the site is behind Cloudflare and the zone's AI bot
  blocking is on (detect through a `cf-mitigated` probe or a documented manual check), since that
  blocks AI search crawlers too.

### B. Answer-ready content

- **`summary` core field** (2 to 3 sentences, 300 chars) on site collections, edited in the SEO
  box as "Answer summary". Used as: the first paragraph the theme can render above the content
  (theme opt-in), the meta description fallback before the excerpt, JSON-LD `abstract`, the feed
  summary, the llms.txt line.
- **Blocks for answer shape**, in the default block set, plain HTML with no rich-result schema:
  *Quick answer* (highlighted answer-first paragraph), *Questions and answers* (`h3` question +
  answer, optional `FAQPage` JSON-LD off by default since it earns no rich result but stays valid),
  *Steps* (ordered, no HowTo schema), *Claim with source* (a statistic or quote with `<cite>` and an
  outbound link; the GEO study's one robust finding), *Definition*, *Comparison table*.
- **Visible dates.** Themes get `publishedAt` and `updatedAt` helpers and the default theme shows
  "Updated <date>"; JSON-LD `dateModified` already exists. Engines read the visible date.
- **Checks in the editor** (part of item 11): has a summary; first paragraph is under 60 words and
  is not a heading or image; at least one question heading for explainer collections; at least one
  outbound source link on claims blocks; a visible date in the template; alt text on every image.

### C. Entities and authorship

- **Site representation.** Organization or Person, name, logo (media), `sameAs` list (social
  profiles, Wikidata, Crunchbase), contact point. Drives `publisher`, the `WebSite` `@id` graph
  and the Organization logo.
- **Author profiles.** Users get `bio`, `url`, `sameAs`, `jobTitle` in their profile meta;
  `/author/<slug>` is a `ProfilePage` listing the author's entries; `Article.author` becomes a
  `Person` with `@id` and `url`. Collections can turn author pages off.
- **Entity tagging.** Taxonomy terms get an optional `sameAs` URL (Wikidata or Wikipedia); the
  entry's terms become `about` and `mentions` nodes. Cheap, and the one schema addition that helps
  disambiguation rather than decoration.
- **One graph per page.** All JSON-LD moves to a single `@graph` with stable `@id`s
  (`<origin>/#organization`, `<origin>/#website`, `<url>#webpage`, `<url>#article`,
  `<origin>/author/<slug>#person`), built by one `schemaGraph()` so themes and plugins can add
  nodes.

### D. Freshness and indexing

- **IndexNow** (item 9) on publish, update, unpublish, delete and redirect, via the outbox so a
  failed ping retries. Bing, Yandex, Naver and Seznam share pings.
- **Sitemaps.** Add `hreflang` alternates, `<lastmod>` for static routes from the build time, and
  a `news` sitemap when a collection's schema type is `NewsArticle` (last 48 hours).
- **Feeds** stay, with full content as an option (exists); add Atom and a per-collection feed,
  since several answer engines ingest feeds for freshness.

### E. Machine-readable surfaces

- **`/llms.txt`**: site title, tagline, summary, sections per collection with cornerstone entries
  first, each line `- [title](url): summary`. Manual picks and excludes in Settings → SEO.
- **Markdown by negotiation**: `Accept: text/markdown` on an entry URL returns the entry as
  Markdown (title, dates, author, summary, blocks → Markdown), following Cloudflare's Markdown for
  Agents convention. Also `?format=md` for testing. Benefit unverified; cost is low because
  `blocksPlain` already exists and needs a Markdown sibling.
- **Not now**: NLWeb schema feeds and `/schema.json` aggregation until any engine says it reads
  them; keep the graph builder able to emit one.

### F. Measurement

- **AI crawler visits.** Site middleware records a daily count per user agent family and path
  class (entry, archive, llms.txt, sitemap, markdown) into a small RomeDB table, not raw logs. The
  Health page shows which engines fetch what and how fresh their last visit is. This is the one
  number that tells a site owner whether A and E are working.
- **Health page** (item 14) adds: entries without summary, without author profile, noindexed but
  linked, orphans, schema type unset, Cloudflare bot-block warning.
- **Search Console and Bing Webmaster** verification tags in Settings → SEO. Pulling their
  reports (Google's "Web" search type includes AI features; Bing's AI Performance report) is a
  plugin, not core.
- **Brand mentions in AI answers** (Yoast's AI Brand Insights): a plugin that asks configured
  models a prompt set and diffs answers. Not core; the CMS exposes the prompt set and results
  table shape.

## Steps

1. **Graph foundation.** Collection `schema` setting with mapping; site representation; author
   profiles and pages; `@graph` builder; drop `SearchAction`; `max-image-preview:large`. Robots
   section per collection and taxonomy; title templates. Update `seo.ts`, `seo-head.ts`,
   `collections.ts`, `settings.ts`, the collection manager and the entry box.
2. **Access and freshness.** Crawler groups and robots.txt; snippet controls; IndexNow through
   the outbox; sitemap `hreflang` and news; `llms.txt`; Markdown negotiation.
3. **Answer-ready editing.** `summary` field; the six blocks; editor checks; internal link
   suggestions and the Links report; primary term and breadcrumbs for flat collections; social tab.
4. **Operations.** Health page with crawler visits; 404 log and redirect types; bulk editor;
   front-end inspector; optional AI Generate.

Each step ships with `essentials`-style live tests (a generated app on Node and Workers) asserting
the rendered head, the JSON-LD graph against schema.org types, robots.txt groups, IndexNow calls
against a stub, and the llms.txt and Markdown responses.

## Outcome

Implemented 2026-10-30, all four steps, with what was left out named below.

- **Graph foundation.** `packages/cms/src/seo.ts` holds the schema types and per-type
  properties, templates, robots directives, author fields, crawler groups and `schemaGraph()`;
  the app's `cms/seo.ts` gathers the inputs. Collections carry `schema`, `robots` and
  `seoTemplates` (collection manager → Search engines card); posts default to `BlogPosting`,
  pages to `WebPage`, and `ARTICLE_TYPES` decides which collections name authors. Settings →
  SEO grew templates, the site representation (name, logo, `sameAs`, X handle), author pages
  and the image preview size. Users have a `slug` (host step 13) and an author profile in
  `meta` (`AUTHOR_FIELDS`, edited at Dashboard → Public profile); `/author/<slug>` is a
  `ProfilePage` listing their articles, with an `author` theme template slot and a sitemap.
  `SearchAction` is gone. Taxonomies take `noindex`.
- **Access and freshness.** Settings → Crawlers (search, AI search, AI training, optional
  `Content-Signal`) renders robots.txt groups; the entry SEO box has `nosnippet`,
  `max-snippet` and `noarchive`, and blocks have an "out of snippets" layout flag
  (`data-nosnippet`). Settings → IndexNow pings `api.indexnow.org` from the outbox after a
  publish, change or unpublish (`server/indexnow.ts`; the key is served at
  `/indexnow/<key>.txt`; needs `APP_URL`, passed to the host as `siteUrl`). Sitemaps carry
  `xhtml:link` alternates on multilingual sites and a `news.xml` for `NewsArticle`
  collections. `/llms.txt` and Markdown by `Accept: text/markdown` or `?format=md`
  (`src/to-markdown.ts`, app `cms/machine.ts`), both switchable in Settings → SEO; entry pages
  send `Vary: Accept` and a `rel=alternate type=text/markdown` link.
- **Answer-ready editing.** A `summary` core field on site collections (theme lead paragraph,
  description fallback, JSON-LD `abstract`, feed, llms.txt). Blocks `core/answer`,
  `core/faq` + `core/faq-item` (optional valid `FAQPage` node, off by default), `core/steps` +
  `core/step`, `core/claim`, `core/definition`. `src/checks.ts` runs the editor's
  "Readiness" list (title and description length, summary, answer-first paragraph, heading
  order, question headings, sources, internal links, length). The SEO box also has a social
  title and description with a preview, a cornerstone flag and related entries to link to.
  Tools → Links lists orphans, weakly linked cornerstones and the most linked entries.
- **Operations.** Host step 14 adds `cms_crawler_visits` and `cms_not_found`; known crawlers
  (by user agent, `crawlerOf()`) are counted per day and page kind on every site surface, and
  404s per path. Tools → Health shows findings (hidden site, `APP_URL`, logo, profiles,
  IndexNow, crawler blocks, the Cloudflare note, articles without summary, cornerstone entries
  marked noindex, authors without bio), crawler visits and missing pages with a Redirect link
  that prefills Tools → Redirects. Tools → SEO editor edits titles, descriptions and summaries
  in bulk with revision checks. Editors see an SEO inspector in the site's edit bar.
- **Tests.** `tests/seo-unit.test.ts` (templates, robots, graph, mapped properties,
  crawlers, Markdown, checks, blocks), live cases in `essentials.test.ts` (collection SEO
  settings, author slugs and profiles, IndexNow pings and retries, traffic), and the generated
  app suite (`generated-runtime-cms-essentials.test.js`: graph, author page, crawler groups,
  llms.txt, Markdown, Health, Links, SEO editor) on Node, Workers and Chromium.

Not done, by choice or for lack of time:

- Canonical hygiene (host and trailing-slash redirects, UTM stripping) and the 404 log's
  companions in the redirect manager (410 is there; regex and CSV import are not).
- The primary term and breadcrumbs through it for flat collections; breadcrumbs stop at the
  collection archive. Entity tagging reads a term's `meta.sameAs` when a field group provides
  it; there is no dedicated field yet.
- The comparison table block; Atom and per-collection feeds; per-collection title variables
  beyond the listed ones.
- AI Generate, Search Console and Bing Webmaster connections, brand mentions in AI answers:
  plugins, as planned.
- Schema aggregation (`/schema.json`, NLWeb): the graph builder emits one page at a time.

## Sources

- [Google: AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)
- [Yoast features](https://yoast.com/features/), [Yoast SEO on WordPress.org, 28.7 and 28.8 changelog](https://wordpress.org/plugins/wordpress-seo/), [Yoast llms.txt launch](https://yoast.com/yoast-seo-june-10-2025/), [Yoast AI features](https://yoast.com/features/ai-features/)
- [Mueller on llms.txt](https://www.searchenginejournal.com/googles-mueller-says-llms-txt-cant-help-llms-differentiate-sites/579304/), [llms.txt one year later](https://hybridranking.com/blog/llms-txt-one-year-later)
- [Schema and rich result deprecations timeline](https://patrickstox.com/technical-seo/on-page/structured-data/schema-deprecations/), [FAQ rich results removed](https://www.elementera.com/blog/google-has-removed-faq-rich-results)
- [Content Signals in robots.txt](https://contextbolt.com/blog/content-signals-robots-txt/), [Cloudflare AI crawler defaults 2026](https://crawlora.net/blog/cloudflare-ai-crawler-block-2026), [AI crawlers and robots.txt guide](https://usemate.ai/blog/ai-crawlers-robots-txt-and-content-signals-a-2026-site-owners-guide)
- [GEO guide, Princeton study summary](https://www.frase.io/blog/what-is-generative-engine-optimization-geo), [GEO at scale, arXiv](https://arxiv.org/pdf/2606.20065)
