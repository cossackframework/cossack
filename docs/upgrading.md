---
title: 'Upgrading'
description: 'Version control and updates for a Cossack project: what to commit, how to back up content, and the one command that updates a project.'
---

# Upgrading

A Cossack project updates with one command:

```bash
pnpm cossack upgrade
```

It moves the Cossack dependencies to the new release and installs them. With the CMS, that is the whole update: the package serves the CMS, and the files in your project are yours. Without the CMS, the command also updates the files the scaffold wrote, with your edits merged. See [`cossack upgrade`](/docs/cossack-cli.md#cossack-upgrade-dir) for every option.

## What is in your repository

A project holds your code and a small number of files that Cossack wrote for you.

| What | Where | Who changes it |
| --- | --- | --- |
| Your pages, components, plugins and themes | `src/` | You. |
| Files the scaffold wrote: entry files, configuration | `src/`, the project root | With the CMS: you. Without it: you and `cossack upgrade`, which merges both. |
| The CMS, when the project has it | the `@cossackframework/cms` package | The package. The project holds no copy. |
| Your CMS configuration | `src/cms.config.ts` | You. |
| Content | the database and media storage | Editors, in the dashboard. |

With the CMS, the project mounts the CMS from the package (`package.json#cossack.packages`): its pages, the sign-in pages, the dashboard and the default theme. Its `src/` has `src/cms.config.ts`, the entry files, application configuration and your own plugins; it has no `src/dashboard/` or `src/pages/auth/` folder for an update to write into. To change how the CMS behaves, use a plugin, `src/cms.config.ts` or a child theme. To replace one page as a whole, use [`cossack eject`](/docs/cossack-cli.md#cossack-eject-package-path).

## What to commit

Commit:

- `src/`, `content/`, `public/` and the configuration files (`package.json`, the lockfile, `vite.config.ts`, `tsconfig.json`, `wrangler.jsonc`);
- `.cossack/`, when the project has one. It records what Cossack wrote and the text it was written from (`.cossack/base/`), which `cossack upgrade` needs to merge your edits, so a fresh clone must have it. The generated `.gitattributes` keeps `.cossack/base/` out of diffs.

A CMS project has no `.cossack/` folder until you copy a page with `cossack eject` or add a plugin: the scaffold records nothing about its files. Its recipe is three keys in `package.json`:

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
3. Resolve conflicts, if it lists any. A conflicting file is kept as it is. Edit it by hand, or run `pnpm cossack upgrade --conflicts=markers` and edit between the markers. A CMS project has conflicts only in pages you copied with `cossack eject` and in plugins.
4. Run your tests and build. The build names any page you overrode that fell behind its package.
5. Take a backup of the database, then deploy.

The Update button in the CMS dashboard runs the same steps in your pipeline. See [CMS updates](/docs/cms/updates.md).

## With the CMS: the project's files are yours

`cossack upgrade` does not compare or change the files of a CMS project. It does this:

1. It sets the dependencies the scaffold owns to the new release's versions. The ones you added or pinned stay.
2. It puts the release's keys into `pnpm-workspace.yaml` (build approvals, overrides) and keeps yours.
3. It installs.
4. It writes a file the CMS needs and your project does not have (`src/cms.config.ts`, `src/stores.client.ts`). It never replaces one.
5. It merges ejected pages and plugins, as described below.

Your `vite.config.ts` and `src/index.ts` call into the packages (`cossackApp()`, `cmsAppOptions`), so a release changes what those calls do and not your files.

Rarely, a release needs a change in one of your files: a new binding in `wrangler.jsonc`, for example. The upgrade then lists the steps, and the build stops with `COSSACK_PACKAGE_HOST_OUTDATED` and the same list until they are done. Make the changes, then set `cossack.template` in `package.json` to the version the message names.

`cossack add` and `cossack remove` still change files: they compare your file with what your recipe renders, write the feature's part, and merge it with your edits. They stop when both changed the same lines.

## Without the CMS: what the command does with each file

For every file the scaffold wrote, `cossack upgrade` compares three texts: your file, the text it was written from, and the new release's text.

- You did not change it: it takes the release's text.
- You and the release changed different lines: the two are merged.
- You and the release changed the same lines: your file is kept, and the plan lists it.
- Only you changed it: it is kept.
- You deleted it: it stays deleted, unless you pass `--force`.
- The release no longer has it: it is deleted when you did not change it, and kept and listed when you did. A folder that becomes empty is removed.

`package.json` and `pnpm-workspace.yaml` are merged by key: dependencies and build approvals the scaffold owns follow the release, and the ones you added or pinned stay, your own `overrides` included. The `scripts` of `package.json` are yours: an upgrade does not change them. The `typecheck` script is `cossack typecheck`, so the steps of a type check come with the CLI.

## Plugins and ejected pages

After the install, `cossack upgrade` also:

- renders each plugin that came from an npm package again from its installed version, with your edits merged;
- merges the package's new text into each file you copied with `cossack eject`.

A plugin rendered from a folder or a tarball is not touched: run `cossack plugins upgrade <name> --source <new source>`.

## Projects from before the served CMS

Earlier releases copied the CMS's files into the project (`src/cms/`, `src/pages/dashboard/(cms)/` and more). This release does not migrate those projects, and `cossack upgrade` stops with `COSSACK_UPGRADE_CMS_COPIED`. Create a new project and move your own work into it:

1. `cossack create my-site --features cms` with the same runtime.
2. Copy your plugins (`src/plugins/<name>/`), `content/`, `public/` files and scripts.
3. Copy your changes to `wrangler.jsonc` or `.env.example`, and your own dependencies in `package.json`.
4. Point the new project at the same database. The content stays as it is.
