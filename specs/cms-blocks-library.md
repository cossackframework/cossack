# Blocks library: the widgets of page builders, in core, as patterns, or from plugins

Builds on `specs/cms-layout.md` (containers, the constrained layout) and `specs/cms-style.md`
(backgrounds). Elementor, Beaver Builder and Flatsome ship fifty to ninety widgets each; the
question was which belong in core "based on how popular they are". No builder publishes
widget-level usage, so the proxies were: free in Elementor (the free tier is what everyone
uses), present in all three builders, in Elementor's Hello Plus set for business sites, and
WordPress.com's 2021 block ranking (Paragraph, Image, Heading, List, Spacer, Separator).

## Decisions

- **Leaf widgets in core, compositions as patterns, the long tail in plugins.** A widget all
  three builders have, or Elementor gives away, becomes a leaf block (Tabs, Accordion, Icon
  box and Icon list, Testimonial, Stat, Pricing plan, Social links, Map, Spacer; then Slides,
  Notice, Countdown, Table of contents, Share, Logos, Breadcrumbs). Hero, Call to action,
  Zigzag, Features, Team and Pricing rows are Group, Columns and Grid holding those leaves, so
  they are patterns a theme ships, not blocks. Lottie, Flip box, Hotspot, Animated headline,
  Progress bar, Image comparison, Instagram feed, PayPal and Stripe buttons, Login, Popups,
  Portfolio and Flip book stay plugin territory.
- **Tabs rendered on the site.** `core/tabs` was offered in every content editor and rendered
  only inside field groups: a defect. The site renders a tablist with the first panel active
  from the server; `tabs.client.ts` switches panels, moves with the arrow keys and opens the
  panel a `#id` link names; without scripting every panel shows under its title. The
  accordion is native `<details>`; "open one at a time" shares a `name` between sections.
- **Any icon, from sprites.** (Revised 2026-11-10; wave 1 shipped a closed set of about 120
  site icons inlined from `cms/site-icons.ts`.) Every Solar icon can be chosen: the CMS package
  holds the catalog by category (`ICON_CATEGORIES`, generated), `field.icon()` is checked
  against it, and `helpers.icon(name)` draws `<svg><use href>` into sprites the
  `cossackCmsIcons()` Vite plugin serves and builds under `/assets/icons/<style>/<group>.svg`:
  one per style and category plus the hot set, cached for a year. Settings → Appearance picks
  the style. Icons in the Card (in place of an image: the icon box), the Icon list and the Tab.
- **Brand icons resolved on the server.** A `brand: true` string field holds a profile URL;
  `renderedBlock` resolves its network by host (`brandIcon`, Simple Icons, CC0; LinkedIn drawn
  in since Simple Icons dropped it) into `RenderedBlock.icons`, so a page carries the icons it
  shows and nothing of the 3,000-icon set. Chosen over hand-written paths (wrong from memory)
  and over shipping the set to the browser.
- **Numbers stay as written.** A Stat's value is text (`1,250`, `4.9`, `12 000`); the count-up
  parses its digits and separators and writes each frame in the same shape, so no locale is
  guessed. Reduced motion shows the number.
- **Maps load from their servers.** An address goes to Google Maps' embed; an embed URL is
  accepted only from Google Maps or OpenStreetMap (`MAP_EMBED_URL`), checked on write and again
  before it reaches an iframe. The block says so in its description.
- **Containers of named items start filled.** New Tabs, Accordion and Icon list blocks get two
  or three named children so they show at once; Columns already started with two.
- **Authors get three doors** (phase 3). A manifest ships `patterns` (stored as `<plugin>-<slug>`
  on grant or theme activation, never overwriting the site's copy; a start adds a theme's
  patterns only while the site has none of them, so a deleted one stays deleted); a plugin's
  `ui.ts` exports `head` for the tags its blocks need, merged under the theme's; a declaration
  lists `variations`, preset shapes the inserter offers as entries of their own, which `newBlock`
  starts from (Hero and Row for the Group, Icon box for the Card, Logo wall, Entry cards). Rich
  text embeds a block by its type alone (`plain` inserter).

## Order

1. Wave 1: Tabs on the site, Accordion, Spacer, icons (set, field, helper, Card, Icon list),
   Testimonial, Stat, Pricing plan, Social links with brand icons, Map.
2. Wave 2: Slides (a carousel of blocks), Notice, Countdown, Table of contents, Share buttons,
   a logos layout for the Gallery, Breadcrumbs.
3. Authors: `patterns` in the manifest, a head hook for non-theme plugins, block variations,
   the "Blocks from a theme or plugin" guide.

## Done when

- A page holds tabs whose first panel is active in the HTML, an accordion with a section open,
  a card with an icon, an icon list in two columns, a testimonial with four stars, a stat
  written `1,250`, a highlighted pricing plan, social links to X and an email address, and a
  map of an address; every block validates and renders, and the X link carries the brand's
  path and color while the email link carries the site's letter icon.
- A card naming an icon outside the set, a stat written `24/7` and a map embed from another
  host are refused on write.
- A theme's template draws `helpers.icon('rocket')` and a plugin block reads `block.icons`.

## Outcome

| Area | Delivered | Verified by |
| --- | --- | --- |
| Wave 1 (2026-11-07) | `SITE_ICON_NAMES`, `field.icon()` and `brand`, `MAP_EMBED_URL`, `brandIcon` (`simple-icons`), `RenderedBlock.icons`, `ThemeHelpers.icon`; ten declarations and renderers (`core/spacer`, `core/accordion`, `core/accordion-item`, `core/icon-list`, `core/icon-item`, `core/testimonial`, `core/stat`, `core/pricing`, `core/social-links`, `core/map`), Tabs on the site, Card `icon` and `style`; `site-icons.ts`, `tabs.client.ts`, `stat.client.ts`, the icon picker for icon fields, seeded containers; `docs/cms/blocks.md` | `section-blocks.test.ts` (package and app), `site-icons.test.ts`, `generated-runtime-cms-themes.test.js` (tabs, a stat and social links through a generated application) |
| Wave 2 (2026-11-07) | `core/slide` inside `core/carousel`, the Gallery's `logos` layout, `core/notice`, `core/countdown` (`countdown.client.ts`), `core/toc` with `withHeadingAnchors` (`headings.ts`: anchors on every heading, kept distinct, the list on the block), `core/share` (`shareUrl`, `share.client.ts`, brand icons by network through `SHARE_BRAND_URLS`), `core/breadcrumbs` and `helpers.breadcrumbs` over `SiteView.breadcrumbs` and `SiteView.url`, built by the site layout from the resolved page (`entryAncestors` shared with the SEO graph) | `page-blocks.test.ts` (package and app), `headings.test.ts`, `generated-runtime-cms-themes.test.js` (anchored headings, the table of contents, share links with the page's address, breadcrumbs) |
| Phase 3 (2026-11-07) | `ManifestPattern` and `manifestProblems` checks, `#seedPatterns` on grant, theme activation and start; `PluginHead`, `activePluginNames`, `ThemeState.plugins`, `pluginHeads` merged by the site layout; `BlockVariation` on declarations with `blockProblems` checks, `BlockOption.variations`, the inserter's variation entries and `plain` mode, `newBlock(type, options, id, variation)`, core variations; docs in `manifest.md`, `plugins.md`, `themes.md`, `blocks.md` | `blocks-authoring.test.ts`, `variations.test.ts`, `generated-runtime-cms-plugins.test.js` (the fixture's pattern is stored on grant and its head tag reaches the site) |
