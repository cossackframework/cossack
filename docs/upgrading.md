---
title: 'Upgrading'
description: 'Version control and updates for a Cossack project: what to commit, how to back up content, and the one command that updates a project.'
---

# Upgrading

A Cossack project updates with one command:

```bash
pnpm cossack upgrade
```

It moves the Cossack dependencies to the new release and installs them. That is the whole update: the packages your project mounts serve the CMS, the sign-in pages and the dashboard, and the files in your project are yours. See [`cossack upgrade`](/docs/cossack-cli.md#cossack-upgrade-dir) for every option.

## What is in your repository

A project holds your code and a small number of files that Cossack wrote for you.

| What | Where | Who changes it |
| --- | --- | --- |
| Your pages, components, plugins and themes | `src/` | You. |
| Files the scaffold wrote: entry files, configuration, models and migrations | `src/`, the project root | You. `cossack upgrade` does not change them. |
| The sign-in pages and the dashboard, on the database ORM | the `@cossackframework/dashboard` package | The package. The project holds no copy. |
| The CMS, when the project has it | the `@cossackframework/cms` package | The package. The project holds no copy. |
| Your CMS configuration | `src/cms.config.ts` | You. |
| Content | the database and media storage | Editors, in the dashboard. |

Without the CMS, a project with sign-in mounts the sign-in pages and the dashboard from `@cossackframework/dashboard`. It keeps `src/dashboard.config.ts` (sign-in methods, OAuth providers, dashboard modules) and its schema: the models, the migrations and the seeders.

With the CMS, the project mounts the CMS from the package (`package.json#cossack.packages`): its pages, the sign-in pages, the dashboard and the default theme. Its `src/` has `src/cms.config.ts`, the entry files, application configuration and your own plugins; it has no `src/dashboard/` or `src/pages/auth/` folder for an update to write into. To change how the CMS behaves, use a plugin, `src/cms.config.ts` or a child theme. To replace one page as a whole, use [`cossack eject`](/docs/cossack-cli.md#cossack-eject-package-path).

## What to commit

Commit:

- `src/`, `content/`, `public/` and the configuration files (`package.json`, the lockfile, `vite.config.ts`, `tsconfig.json`, `wrangler.jsonc`);
- `.cossack/scaffold.json`, `.cossack/plugins.json` and `.cossack/base/`, when the project has them. They record the pages you copied with `cossack eject` and the plugins you added, with the text each was made from, which `cossack upgrade` needs to merge your edits. The generated `.gitattributes` keeps `.cossack/base/` out of diffs.

A new project has no `.cossack/` folder to commit: the scaffold records nothing about the files it wrote. Its recipe is a few keys in `package.json`:

```json
"cossack": {
  "runtime": "cloudflare",
  "packages": ["@cossackframework/cms"],
  "features": ["cms"],
  "template": "0.9.0"
}
```

`features` is what `cossack add` and `cossack remove` change. `template` is the release your project's own files were written for.

Never commit:

- `node_modules`, `dist`, `.wrangler`;
- `storage/`, which holds the local database file and local media;
- secrets: `.dev.vars`, `.env`.

The generated `.gitignore` already does this.

## Content is data, not code

Posts, pages, media and settings are in the database and the media storage, not in the repository. Back them up on their own schedule:

- Tools → Export in the dashboard (a `.romedb` file or JSON);
- RomeDB Cloud's own backups;
- a copy of `storage/romedb` for a database file on your server.

A seed script that fills a new install is for first installs. It is not a backup.

## Database changes run themselves

A new CMS version may change the database. The changes are steps that only add: they run when the new build starts and finds steps it has not applied. You run no migration command.

Take a backup before you deploy an upgrade. An older build refuses a database that has steps it does not know. So going back to an older version means restoring the backup together with the older code.

## The workflow

1. Make a branch.
2. Run `pnpm cossack upgrade`. Add `--dry-run` first to see the plan and write nothing.
3. Resolve conflicts, if it lists any. Only a page you copied with `cossack eject` or a plugin file can conflict. A conflicting file is kept as it is. Edit it by hand, or run `pnpm cossack upgrade --conflicts=markers` and edit between the markers.
4. Run your tests and build. The build names any page you overrode that fell behind its package.
5. Take a backup of the database, then deploy.

The Update button in the CMS dashboard runs the same steps in your pipeline. See [CMS updates](/docs/cms/updates.md).

## The project's files are yours

`cossack upgrade` does not compare or change your files. It does this:

1. It sets the dependencies the recipe owns to the new release's versions. The ones you added or pinned stay.
2. It puts the release's keys into `pnpm-workspace.yaml` (build approvals, overrides) and keeps yours.
3. It installs.
4. It writes a file a mounted package needs and your project does not have (`src/cms.config.ts`, `src/dashboard.config.ts`, `src/stores.client.ts`). It never replaces one.
5. It merges ejected pages and plugins, as described below.

Your `vite.config.ts` and `src/index.ts` call into the packages (`cossackApp()`, `nodeApplication()`, `cmsAppOptions`), and the `typecheck` script is `cossack typecheck`. A release changes what those calls do, not your files.

Rarely, a release needs a change in one of your files: a new binding in `wrangler.jsonc`, or a migration for a new column of the `users` table. The upgrade then lists the steps, and the build stops with `COSSACK_PACKAGE_HOST_OUTDATED` and the same list until they are done. Make the changes, then set `cossack.template` in `package.json` to the version the message names.

`cossack add` and `cossack remove` still change files: they compare your file with what your recipe renders, write the feature's part, and merge it with your edits. They stop when both changed the same lines.

The `scripts` of `package.json` are yours too: an upgrade does not change them.

## Plugins and ejected pages

After the install, `cossack upgrade` also:

- renders each plugin that came from an npm package again from its installed version, with your edits merged;
- merges the package's new text into each file you copied with `cossack eject`.

A plugin rendered from a folder or a tarball is not touched: run `cossack plugins upgrade <name> --source <new source>`.

## Projects from earlier releases

A project that still has file records (`.cossack/scaffold.json` with `files`, and `.cossack/base/` for them) loses them on its first upgrade: the recipe moves into `package.json`, and the records are deleted. Its own copies of the sign-in pages and the dashboard stay where they are and keep working, but no release updates them. To get them from the package, create a new project with the same features and move your models, migrations and pages into it.

### A copied CMS

Earlier releases copied the CMS's files into the project (`src/cms/`, `src/pages/dashboard/(cms)/` and more). This release does not migrate those projects, and `cossack upgrade` stops with `COSSACK_UPGRADE_CMS_COPIED`. Create a new project and move your own work into it:

1. `cossack create my-site --features cms` with the same runtime.
2. Copy your plugins (`src/plugins/<name>/`), `content/`, `public/` files and scripts.
3. Copy your changes to `wrangler.jsonc` or `.env.example`, and your own dependencies in `package.json`.
4. Point the new project at the same database. The content stays as it is.

### A hand-written Node entry from 0.8

Since 0.9 the server reads the client build's manifest through `env.ASSETS`, not from disk. An entry built with `nodeApplication()` passes it. A hand-written one, such as `serve({ fetch: request => app.fetch(request, env) })`, must add it, or every production page fails with `COSSACK_CLIENT_MANIFEST_MISSING`:

```ts
import { createStaticAssets } from '@cossackframework/node-adapter';

const env = { ...process.env, ASSETS: createStaticAssets({ root: './dist/client' }) };
```

### UI components from 0.8 to 0.9

In 0.9 most `@cossackframework/ui` components took native attributes and events on a
named element, and gained stable IDs and controlled or uncontrolled state
(`value` with `onChange`, or `defaultValue`). A component whose old props no longer type
check needs one of these changes:

| Component | What to change |
| --- | --- |
| Textarea, Select, NativeSelect | Bind `.value`, not `value`. For a multiple select, mark the selected options instead. |
| InputGroup | Native input props go on the group; they reach the input. |
| PasswordInput | Use `value`, `onChange` and `disabled` instead of `type`, `.value` or `?disabled`. `showLabel`, `hideLabel` localize the button. |
| InputOTP | One native input with drawn slots: change selectors that expect one input per digit. `defaultValue` or `value` with `onChange`; `length` 1 to 32. |
| Combobox | Give an `id` and a label (`for` or `aria-label`). `defaultValue` or `value` with `onChange`. |
| MultiSelect | Give an `id` and a label. Read the tags with `FormData.getAll(name)`. |
| Calendar, DatePicker | Give an `id`. Dates are `yyyy-mm-dd` (check with `isCalendarDate`). DatePicker is a native date input with a calendar button; `placeholder` is gone. |
| Modal, Sheet, Drawer | `open` is controlled: set `open=false` in `onClose`, or use `defaultOpen`. Drawer's attributes reach the dialog, not the panel. Give `aria-label` or `aria-labelledby`. |
| Popover | Give an `id`. Panel attributes go in `contentProps`. Use `data-side` instead of `cs-popover--<side>` classes. |
| DropdownMenu, ContextMenu | Give an `id`; ContextMenu also `menuLabel`. Panel attributes go in `menuProps`. A separator is its own `{ separator: true }` entry. |
| Tooltip | Give an `id` and a text `label` (not `content`); put `aria-describedby` with that ID on the trigger. |
| HoverCard | Give `id`, `label` and `content`, and a focusable trigger. |
| AlertDialog | Give an `id` and a `title`. Set `open=false` in `onClose`. `onAction` does not close it. |
| Command | Give an `id` and a `label`. Ctrl/Meta+K needs `shortcut: true`, on one palette only. |
| Accordion, Collapsible | Give an `id`. `summary` (Accordion) and `trigger` (Collapsible) are text or a template; style the button with `triggerProps`. |
| Tabs | Give an `id` and a `label`. Use `value` with `onChange`, not the `active` field. Item labels that are not text need `ariaLabel`. |
| Toggle, ToggleGroup | ToggleGroup needs a `label`. Use `value` with `onChange`, not the `selected` field. |
| Menubar | Give an `id` and a `label`, and each menu a `value`. Do not write `openMenu`. |
| NavigationMenu | Give an `id` and a `label`, and each section and link a `value`. `activeSection` is gone. |
| Pagination | Choose `onPageChange(page)` or `href(page)`, not both. |
| Breadcrumb | Each item needs a `value`. The last item keeps its `href`. |
| ButtonGroup | Give a `label`. |
| AspectRatio | The ratio box is a CSS `aspect-ratio` element: change selectors that used the padding wrapper. |
| Skeleton | A circle uses `circle: true` with `size`, not width and height. |
| Card, Item | Rename `interactive` to `hoverable`. |
| Alert | Choose `announcement` (`assertive`, `polite` or `off`). Icons are imported entries. |
| Progress | Give a `label`. An omitted `value` means unknown progress; pass 0 for zero. |
| Field | Give `label`, `for` and a `control(attributes)` callback that spreads the attributes onto the control, instead of a child. |
| Avatar, AvatarGroup | Give `alt` (empty for decoration). Group items need a `value` and `alt`; `overlap` is a positive distance. |
| Table | Attributes for the scrolling wrapper go in `wrapperProps`. |
| ScrollArea | Give a `label`; there is no nested viewport element. |
| Resizable | Use `primary` and `secondary` props, an `id` and a `label`; `defaultSize` is a percentage. |
| Sidebar | Give an `id`, a `label` and a `value` per item. `onToggle` receives the next collapsed value. `cs-sidebar__sublink` is now `cs-sidebar__link`. Offcanvas needs `restoreFocusTo`. |
| Toast | Call `toast` in the browser only. Use `show`, `dismiss`, `clear` instead of `toastStore.set` and `update`. |
| Carousel | Give an `id`, a `label` and `slides: [{ value, label, content }]` instead of children. Use `scrollToSlide(value)`, not `viewportRef`. |
| Attachment | Give a `name`. Choose the color with `statusVariant`, not the status text. |
| Bubble | Each reaction needs a `label`. Message shows name, time and avatar for both variants. |
| MessageScroller | Give an `id` and a `label`. Rename `newMessageLabel` to `jumpLabel`; use `scrollToBottom()`, not `scrollRef`. |
| Icon | Use `variant` for the Solar style (`style` is CSS). Pass an imported `entry`; the name lookup is gone. |
| AuthForm (blocks) | Give an `id` and `onSubmit(data, { signal })`. Replace `social: true` with `providers` and `onSocial`. |
| CommandPalette (blocks) | Give an `id` and a `label`. Ctrl/Meta+K needs `shortcut: true`. |
| DashboardStat (blocks) | Each metric needs an `id`. Set `tone` for good or bad; `trend` is only the direction. |
| SettingsPanel (blocks) | Give an `id`. Use `defaultValues`, or `values` with `onChange`. Button rows need `action` text, and the panel `onAction`. |

The browser entry of the renderer no longer has `renderToString`: import it from
`@cossackframework/renderer/server`.

### Stricter template checks in 0.9.2

`cossack check templates` and the editor type event listeners by their element. A
`@change` listener on a `<select>` (or an `<input>`) receives an `Event`, so a handler
typed `(event: InputEvent) => void` no longer checks: type it `(event: Event)` and read
the value from `event.currentTarget` or `event.target`.

### Changes after 0.9.2

- A `@Server` method that calls `this.redirect()` completes in the browser with the value it
  returned, not `undefined`. A `!result` check after such a call can go.
- A page's `post()` refuses form posts from other sites (403 `COSSACK_CROSS_SITE_REQUEST`).
  A page that another site posts to, such as an OAuth `form_post` callback, sets
  `@Page({ allowCrossSiteForms: true })`.
- The browser build stubs `src/middlewares/**`, `src/server/**`, `*.server.ts` and the recipes'
  `src/jobs`, `src/schedules` and `src/notifications`, and a module that imports
  `@cossackframework/auth` (other than `createAuthorizer`). A browser stub of your own for
  these folders can go.
- The browser build fails when a kept method passes, rather than calls, a method it removes
  (`items.map(this.row)`). Call it or mark it `@Client()`.
