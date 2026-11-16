# The example plugin

A plugin that uses most of what a CMS plugin can do, kept here to try the plugin API in
`pnpm dev:cms` and to copy from. It is for development only:

- `cossack add cms` renders only what `packages/cms/app/cossack-recipe.json` lists, and this
  folder is not listed.
- The `@cossackframework/cms` package leaves it out (`!app/src/plugins/example` in its
  `files`), and `.gitattributes` marks it `export-ignore` for source archives.
  `packages/cms/tests/example-plugin.test.ts` checks both, and runs the hooks on a live host.
- `packages/cossack/tests/generated-runtime-cms-example-plugin.test.js` copies it into a
  generated CMS app and checks every row below in the built app.

Under Plugins, grant **example**. Then:

| What | Where it shows | Source |
| --- | --- | --- |
| A menu link with an icon | Dashboard navigation: Example | `ui.slots['dashboard.nav']` in `plugin.json` |
| A screen of its own | `/dashboard/example` | `pages/dashboard/example/index.ts` |
| Records of its own, read and written as the user | The screen's reading list | `resources` in `plugin.json`, `pluginCms('example')` |
| A query across content, through a grant | The screen's posts by status | `permissions.resources`, `resource('cms/posts').count()` |
| A data rule | Adding an address that is not `https://`, `http://` or `/…` fails | `beforeWrite` in `server.ts` |
| A notice on every screen | Above each dashboard screen; Settings → Plugins turns it off | `cms.dashboard.notices` in `server.ts` |
| A count on the taskbar | Reading list (n) at the bottom of the dashboard | `cms.dashboard.taskbar` in `server.ts` |
| A quick action | "Add to reading list" under each entry in a list | `cms.dashboard.entry-actions` in `server.ts` |
| A box on the overview | Dashboard home | `slots['dashboard.overview']` in `ui.ts` |
| A block and its stylesheet | Callout, in the block inserter and on the site | `blocks` in `plugin.json`, `ui.ts`, `assets/example.css` |
| A note on every entry's Markdown | `/<entry>?format=md` | `cms.site.markdown` in `server.ts` |
| A Markdown page in the site's frame | `/example/guide` | `pages/(site)/example/guide.md` |
| Settings | Settings → Plugins → Example plugin | `settings` in `plugin.json` |
| A command | `cossack example:stats` | `commands` in `plugin.json`, `server.ts` |

