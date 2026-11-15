---
title: 'Upgrading'
description: 'Version control and updates for a Cossack project: what to commit, how to back up content, and the one command that updates a project.'
---

# Upgrading

A Cossack project updates with one command:

```bash
pnpm cossack upgrade
```

It moves the Cossack dependencies to the new release, installs them, and updates the files the scaffold wrote, with your edits merged. See [`cossack upgrade`](/docs/cossack-cli.md#cossack-upgrade-dir) for every option.

## What is in your repository

A project holds your code and a small number of files that Cossack wrote for you.

| What | Where | Who changes it |
| --- | --- | --- |
| Your pages, components, plugins and themes | `src/` | You. |
| Files the scaffold wrote: entry files, layouts, configuration | `src/`, the project root | You and `cossack upgrade`, which merges both. |
| The CMS, when the project has it | the `@cossackframework/cms` package | The package. The project holds no copy. |
| Your CMS configuration | `src/cms.config.ts` | You. |
| Content | the database and media storage | Editors, in the dashboard. |

With the CMS, the project mounts the CMS from the package (`package.json#cossack.packages`): its pages, the sign-in pages, the dashboard and the default theme. Its `src/` has `src/cms.config.ts`, the entry files, application configuration and your own plugins; it has no `src/dashboard/` or `src/pages/auth/` folder for an update to write into. To change how the CMS behaves, use a plugin, `src/cms.config.ts` or a child theme. To replace one page as a whole, use [`cossack eject`](/docs/cossack-cli.md#cossack-eject-package-path).

## What to commit

Commit:

- `src/`, `content/`, `public/` and the configuration files (`package.json`, the lockfile, `vite.config.ts`, `tsconfig.json`, `wrangler.jsonc`);
- `.cossack/scaffold.json` and `.cossack/plugins.json`, which record what Cossack wrote;
- `.cossack/base/`, the text each of those files was written from. `cossack upgrade` needs it to merge your edits, so a fresh clone must have it. The generated `.gitattributes` keeps it out of diffs.

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
3. Resolve conflicts, if it lists any. A conflicting file is kept as it is. Edit it by hand, or run `pnpm cossack upgrade --conflicts=markers` and edit between the markers.
4. Run your tests and build. The build names any page you overrode that fell behind its package.
5. Take a backup of the database, then deploy.

The Update button in the CMS dashboard runs the same steps in your pipeline. See [CMS updates](/docs/cms/updates.md).

## What the command does with each file

For every file the scaffold wrote, `cossack upgrade` compares three texts: your file, the text it was written from, and the new release's text.

- You did not change it: it takes the release's text.
- You and the release changed different lines: the two are merged.
- You and the release changed the same lines: your file is kept, and the plan lists it.
- Only you changed it: it is kept.
- You deleted it: it stays deleted, unless you pass `--force`.
- The release no longer has it: it is deleted when you did not change it, and kept and listed when you did. A folder that becomes empty is removed.

`package.json` and `pnpm-workspace.yaml` are merged by key: dependencies and build approvals the scaffold owns follow the release, and the ones you added or pinned stay, your own `overrides` included. The `scripts` of `package.json` are yours: an upgrade does not change them.

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
