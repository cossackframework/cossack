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
