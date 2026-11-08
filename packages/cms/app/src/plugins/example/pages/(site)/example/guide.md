---
title: "The example plugin"
description: "What a CMS plugin can add, and where each part lives in its source."
---

# The example plugin

This page is a Markdown file in the plugin, `pages/(site)/example/guide.md`. It routes like a page
in `src/pages/(site)`, so the site's layout wraps it in the active theme's header and footer, the
way a folder's `layout.ts` wraps the pages under it. It renders per request, never at build time,
and answers only while the plugin is active. CMS applications have the `markdown` feature; in
another application, add it with `cossack add markdown`.

| Part | File |
| --- | --- |
| The Example screen and its menu link | `pages/dashboard/example/index.ts`, `ui.slots` in `plugin.json` |
| The reading list, records of the plugin's own | `resources` in `plugin.json` |
| Notices, taskbar counts, quick actions, a note on every entry's Markdown | `server.ts` |
| The overview box, the Callout block and its stylesheet | `ui.ts`, `assets/example.css` |
