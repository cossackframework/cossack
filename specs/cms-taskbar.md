# Taskbars: the site's and the dashboard's

Status: implemented on branch `cms-foundation`, 2026-11-01. Replaces the editor's floating bar of
[CMS themes](cms-themes.md) ("Front-end block editor"). See [Outcome](#outcome).

WordPress shows signed-in users a toolbar along the top of every page. Cossack shows one along
the bottom, as a desktop taskbar: the site's logo opens the dashboard's navigation, the middle
holds what the current page offers, and the user sits at the right. The dashboard gets the same
bar as a status line.

## Decisions

- **The site layout owns the bar.** Every site page under `src/pages/(site)/` shows it to a
  signed-in user; visitors' HTML carries no trace of it. Layouts initialize before the page and
  keep their `@State` across client navigations, so the bar is a `server$` resource
  (`taskbar` on `SiteLayout`): built during render, after the page's `init()`, and rebuilt on
  every navigation. Pages describe themselves with `c.set('cms.taskbar', { entry, seo })`
  (`TaskbarPage` in `cms/taskbar.ts`); `cms/site-taskbar.ts` builds the view from that, the
  resolved path (`cms.site`), the user's navigation and the active plugins.
- **Shape.** Full width, fixed to the bottom, 2.5rem, desktop and tablet only (`md:`); a spacer
  keeps the page's end visible. In edit mode the page marks its editor `data-site-editing` and
  the bar keeps only its first item (the start menu, `[data-taskbar-start]`) and its last (the
  user, `[data-taskbar-end]`); the middle items hide (`body:has([data-site-editing])`) and the
  editor's controls take their place, between the two (`SiteEditor.placeBar` measures them into
  `--cms-taskbar-start` and `--cms-taskbar-end`). Leaving edit mode shows the items again
  (2026-11-06; before, the whole bar hid behind a floating pill of the editor's).
- **Left: the start menu.** The site's logo and title open Dashboard and the user's navigation
  modules, the same `navigation(c)` the dashboard sidebar shows.
- **Middle: the page's tools.** An entry the user may edit: its status (as small text
  underlined in the status's color, `data-taskbar-status`, not a badge: the bar is quieter
  that way, 2026-11-09), *Live Edit* (in place, at `?edit`, which the entry page already
  honors; the same muted link style as *Edit*, with a cursor icon, since 2026-11-09) and
  *Edit* (the dashboard's editor); the SEO
  inspector, a magnifier before its label
  (title, description, robots, canonical, image, schema types, the Markdown view) wherever the
  page has an SEO view. An archive: *All <collection>*. A term: *Edit <term>*. An author page:
  *Edit user*. The latest-posts front page: *Reading settings*.
- **A static front page is edited at `/`.** `/` resolves as the home page (`resolvePath` of an
  empty path) and `src/pages/(site)/index.ts` is a subclass of the catch-all's page with its own
  `@Page` (the build reads each page file's decorator, so a bare re-export fails), so the front
  page is shown, tracked and edited in place (`/?edit`) by the same code as every other entry.
- **Right.** *New*: an entry of every collection the user may create, and *Upload file*. The user's
  avatar (their picture, or their initials when they have none) and name open the account modules
  (Profile, Public profile, Sessions) and *Log out*.
- **Plugins.** Two host slots join `dashboard.nav`: `site.taskbar` and `dashboard.taskbar`.
  A manifest's `ui.slots` lists links (label, same-site href, optional permission), served by
  `cms.slotLinks()`. Links, not markup: the bar renders them itself.
- **Leaving edit mode drops `?edit`** from the address (`exitEditing`), so a reload shows the page.
- **The dashboard taskbar** replaces the footer of the shared dashboard layout: the brand opens
  the site; status items show what waits for the user with counts (comments to moderate, entries
  pending review, new form submissions, schema migrations, plugins waiting for a grant, events
  and writes waiting for delivery), then the `dashboard.taskbar` links; *Screen options* and
  *Help* at the right; the copyright last. The items come from `dashboardStatus(c)` in
  `src/dashboard/access.ts`, the storage seam the CMS replaces (an ORM application has none),
  as a `server$` resource so they are fresh on every navigation.
- **Screen options and Help are popovers a screen renders.** `screenHelp(body)` and
  `screenOptions(body)` from `src/dashboard/page.ts` render `#screen-help` and `#screen-options`
  as native popovers above the bar; the taskbar's buttons target them and show only when the
  screen has one (`group-has-[#screen-help]`). Help ships on the dashboard home and the entries
  list.
- **Screen options on the entries list**: the optional columns (slug, authors, language, the
  taxonomy, plugin columns, date; the title always shows) and the entries a page lists (1 to 100,
  default 20), applied together. They are kept per collection in a cookie
  (`cs-screen-entries-<collection>`, path `/dashboard`), as the sidebar keeps its collapsed state:
  per browser, read at SSR, no schema. User meta keeps only declared fields, so a per-user store
  would need a host table; that waits for a screen whose options must follow the user.
  `screenCookie()`, `screenPreferences()`, `saveScreenPreferences()` and `clampPerPage()` in
  `src/dashboard/page.ts` are the helpers for the next screen, such as the editor's boxes.
- **Not built.** A separate notifications toolbar: the status items are the notifications. Presence
  for collaboration: it would sit in the right group, beside the user.

## Outcome

| Area | Delivered | Verified by |
| --- | --- | --- |
| CMS package | `HOST_SLOTS` gains `dashboard.taskbar` and `site.taskbar` | `tests/unit.test.ts` |
| CMS app | `cms/taskbar.ts` (`TaskbarPage`, `TaskbarView`, `taskbar()`, the SEO inspector), `cms/site-taskbar.ts`; the site layout's `taskbar` resource and `doLogout`; the entry page publishes its context, marks edit mode and strips `?edit` on exit; `/` served by the catch-all page, a static front page editable in place; `dashboardStatus()` in `dashboard/access.ts`; Help on the dashboard home and the entries list; Screen options on the entries list | `generated-runtime-cms-themes.test.js` (an editor's page carries the bar, a visitor's does not; the bar opens the editor at `?edit` and hides, and returns without `?edit` on Exit), `generated-runtime-cms.test.js` (the static front page's editor at `/?edit`, in HTTP and in Chromium; Screen options hide Slug and list one page per screen, kept across a reload), `generated-runtime-cms-essentials.test.js` |
| Scaffold | The dashboard layout's taskbar with `statuses`, `dashboardStatus()` in the template's `access.ts` (empty), `DashboardStatus` in `dashboard/types.ts`, `screenHelp()`, `screenOptions()` and the Screen options cookie helpers in `dashboard/page.ts` | `tests/sidebar-rendering.test.js`, `tests/screen-options.test.js` |
