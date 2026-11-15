# Upgrades that merge, ejected overrides, and moving projects to the served CMS

Status: planned 2026-11-15. Part 3 of 3, after `specs/package-routes.md` and
`specs/cms-served-app.md`. Steps 1 to 4 do not depend on them and can be built first.

## Why

`cossack upgrade` updates a scaffolded file only when the project never edited it.
An edited file is skipped for good, or overwritten with `--force-file`, losing the
edits. Once the CMS is served from its package, what stays in a project is glue,
the template shell (layouts, `list-table`, entry files) and overrides. Those still
need upgrades that keep local edits. Existing projects also have to move from the
copied CMS to the served one without losing what they changed.

## What is true today (2026-11-15)

- **The manifest: `.cossack/scaffold.json`.**
  - Fields: schema 3, `writeManifest` in `scaffold/src/index.js` 2410-2470, `templateVersion`, `runtime`, `preset`, `explicitFeatures`, `resolvedFeatures`, `dashboardModules`, `config`, `dependencyBaseline`, and `files: { <path>: { capability, hash } }`.
  - `hash` is the sha256 of the file on disk after writing (2435).
  - Local-env files are not recorded (2422).
  - During a plan, a file that was not written keeps its old hash (2424-2433).
- **Upgrade.** `cossack/src/commands/upgrade.js`:
  - It renders the target recipe and sorts each file with `classifyFile` (325-332): `excluded`, `missing`, `canDelete`, `upToDate`, `canUpdate` (current == recorded) or `modified`. Files not in the manifest are `canUpdate` if absent, `upToDate` if equal, else `modified` (377-381).
  - `--apply-template`, `--force` and `--force-file` select files at 143-149.
  - The plan JSON is built at 172-186. `--dry-run` stops at 201-208. A stale plan raises `COSSACK_UPGRADE_PLAN_STALE` (212-220).
  - Apply writes the rendered text as it is (242-247).
  - `EXCLUDE_FROM_SYNC` (24-36): `package.json`, lockfiles, `tsconfig*`, `wrangler.*`, the manifest. `package.json` and `pnpm-workspace.yaml` get a key-level three-way merge (`planDependencyChanges`, `index.js` 2196-2338). Text files get none.
- **Old releases** are loaded by `upgrade-scaffold.js` `loadUpgradeScaffold` (24-57), which installs a release into a temp directory. Today it renders the old release only when `dependencyBaseline` is missing (`upgrade.js` 118-128).
- **Bug: preserved files lose their base.** `refreshManifest` (442-462) sets `templateVersion` to the target for the whole manifest, but keeps old hashes for preserved files. Rendering `templateVersion` then no longer reproduces those files' base. Workspace-linked apps also change content without a version bump.
- **Plugins** have their own manifest, `.cossack/plugins.json`, with `package`, `version`, `source`, `files` with hashes, `inApp` and `unrestricted` (`scaffold/src/plugins.js` 158-169, 329). `planPlugin` (176-202) uses the same two-way rules. `applyAtomically` (334-372) already keeps the upstream hash as the baseline for preserved edits (351-360). Upgrades re-resolve `source.spec` or `--source` (227-236).
- **UI eject** is the precedent for copying package code into a project: `cossack add ui <component>` (`commands/add.js` 31-35, 62-76; `templates/ui.js` 18-78). It rewrites imports to public exports, refuses an existing file without `--force`, and records nothing.
- **Name clash:** `cossack cms ...` is the remote management API namespace (`commands/cms.js` 52-63, `cms/catalog.js:250`). A local verb cannot live there.
- **The gif84 manifest is stale.**
  - Header: templateVersion `0.9.0`, cloudflare, 324 files, 239 of them `cms`.
  - 44 files differ from their recorded hash, but 31 of those are byte-identical to the current workspace `packages/cms/app` sources. They were synced by hand, not edited.
  - Its `@cossackframework/*` packages are symlinks into the monorepo. The project is a git repository with no commits.

## Decisions

### Merge bases are stored, not rebuilt

- **Content-addressed base store.** `.cossack/base/<sha256>` holds the upstream text of each owned file as last written or merged.
  - Manifest schema 4: `files: { <path>: { capability, hash, base } }`. `hash` is the file on disk after the operation; `base` is the upstream content it descends from.
  - A verbatim write sets `base = hash`. A preserved file keeps its base. A merge sets `base` to the new upstream.
  - Blobs no manifest references are deleted on every manifest write.
  - The store is committed: a fresh clone must be able to merge. The scaffold's `.gitignore` leaves it in. The scaffold also writes a `.gitattributes`, which it has none of today, with `.cossack/base/** -diff linguist-generated`.
  - Rebuilding a base from a release was rejected. Linked and unpublished packages cannot be rendered by version, it needs the network, and the global `templateVersion` already drifts (see the bug above).
- **Reading a schema-3 manifest.**
  - Render the recorded `templateVersion` once with `loadUpgradeScaffold`.
  - Use a file's rendered text as its base only when its hash equals the recorded hash.
  - Otherwise the file has no base and is handled as today: preserved, and reported as `noBase`.
  - The first schema-4 write records bases from then on. `--force` keeps restoring missing files.
- **`dependencyBaseline`** keeps its own key-level merge. `package.json` and the other `EXCLUDE_FROM_SYNC` files are unchanged by this spec.

### Classification and flags

Each owned file has *ours* (the file on disk), *base* (the stored blob) and *theirs* (the target render).

| Case | Class | With `--apply-template` |
| --- | --- | --- |
| ours missing | `missing` | restored only with `--force` |
| theirs gone upstream, ours == base | `canDelete` | deleted |
| theirs gone upstream, ours != base | `modified` | kept, reported |
| ours == theirs | `upToDate` | base becomes theirs |
| ours == base | `canUpdate` | theirs written |
| theirs == base | `local` (only the project changed it) | kept |
| all three differ, merge clean | `canMerge` | merged text written |
| all three differ, merge conflicts | `conflict` | kept; markers only with `--conflicts=markers` |
| no base | `noBase` | kept, as today |

- **Text merge:** `scaffold/src/merge.js`, `mergeText(base, ours, theirs) → { text, conflicts }`. It uses a maintained pure-JS diff3 package (for example `node-diff3`; take its latest version and check its license). It merges line by line on LF and writes back with the file's original line endings. Binary and non-UTF-8 files never merge: they are `modified`. A file of more than 1 MiB is not merged.
- **Conflict markers.** `--conflicts=markers` writes git-style markers:

  ```
  <<<<<<< yours
  ...
  ||||||| base
  ...
  =======
  ...
  >>>>>>> cossack <version>
  ```

  It records `base = theirs`, so the next upgrade does not merge the file again. Before planning, `cossack upgrade` refuses to run while any owned file still contains a marker line (`COSSACK_UPGRADE_UNRESOLVED_CONFLICT`). Without the flag a conflicting file is untouched, and the plan carries the merged text with markers so a tool or an agent can show it.
- **The plan JSON** gains:
  - `files.merges: [{ path, result: 'clean' | 'conflict', conflicts }]`, and `files.noBase`;
  - a `reason` on each entry of `files.conflicts`;
  - `nextActions` naming each conflict.

  Merged paths join the stale-plan `expected` set.
- **The same merge everywhere a recipe rewrites owned files:** `cossack add` and `cossack remove` (`buildPlan`, `index.js` 2129-2187, where both sides changed), and `cossack plugins upgrade`. `.cossack/plugins.json` gains `base` per file, in the same store.

### Ejected overrides

- **`cossack eject <package> <path>`** copies a served file into the project at its
  app path and records it. The command is top-level because `cossack cms` is
  taken.
  - `<package>` is a mounted package's name or the short alias the package
    declares (`cossack.alias: "cms"`).
  - `<path>` is an app path (`src/pages/(site)/search/index.ts`), a route
    (`/search`, resolved through the route table), or a served plugin
    (`plugins/default-theme`), which ejects the whole plugin.
  - Only pages, layouts, loadings, config files and plugins can be ejected. These
    are what `specs/package-routes.md` lets the application shadow. A served module
    such as `cms/site.ts` cannot be: served code imports it relatively, so a copy
    would never be used. A plugin or `cms.config.ts` is the way to change behaviour
    there.
  - The command refuses an existing file without `--force`.
- **Imports are rewritten, like UI eject.** A relative import that resolves inside
  the package becomes the package specifier
  (`'../../../cms/site'` → `'@cossackframework/cms/app/cms/site'`). The copy and
  the package then share module instances. The rewrite is a pure function of the
  text and the path, and upgrades apply it to *theirs* before merging, so an
  ejected file merges cleanly against package changes.
- **The record:** manifest `ejected: { <path>: { package, version, source, base } }`,
  where `source` is the path under the package root and `base` is a blob of the
  rewritten package text at eject time.
  - `cossack upgrade` treats ejected files like owned files, with *theirs* taken
    from the installed package version (after `pnpm` has installed the target).
  - `cossack eject --restore <path>` deletes the copy and the record. It needs
    `--force` when the copy differs from its base.
  - `cossack eject --diff <path>` prints base → package and base → copy.
- **Package updates outside `cossack upgrade`.** A project that runs `pnpm up` gets
  the new package without merging its ejected files. The framework's override
  report (`specs/package-routes.md`) reads `.cossack/scaffold.json` `ejected` when
  the file exists, and it flags each override whose package file changed since its
  base: `src/pages/(site)/search/index.ts overrides @cossackframework/cms 0.10.0;
  the package changed it since 0.9.0: run cossack upgrade`. It never fails the build.

### Moving a project from the copied CMS to the served one

This runs as part of `cossack upgrade` when the target recipe has `served` paths
that the manifest owns. `--dry-run` shows all of it first. The rules are below.

- **Served files.** For each owned path that is now served:
  - Delete it and drop its entry if *ours* equals the recorded hash, the installed
    package's file, or the old release's render. The package-file case covers
    stale manifests like gif84's.
  - Otherwise keep it as an ejected override, with its imports rewritten as above
    and recorded as ejected:
    - `base` is the old release's render when that render matches the recorded
      hash;
    - otherwise it has no base and is reported for review with
      `cossack eject --diff`.
  - A served module that is not routable (for example `src/cms/site.ts`) and was
    changed is a conflict with reason `module-not-overridable`. The migration
    stops before writing anything and lists the files. The project moves the
    change into a plugin or `cms.config.ts`, then reruns, or reruns with
    `--force-file <path>` to drop the edit.
- **Facade paths** (today's `replaces`, for example `src/auth.ts`, `src/brand.ts`):
  - if unchanged by the same three tests, they become the facade;
  - if changed, the result is the same `module-not-overridable` conflict, because
    served code would not use the copy.
- **`src/cms/resources.ts`:**
  - unchanged: the default `src/cms.config.ts` is written;
  - changed: its exports move into `src/cms.config.ts`, and the plan lists the file
    for review.
- **The default theme:**
  - unchanged: deleted, since it is now served;
  - changed: kept whole as an ejected plugin, and the plan recommends a child theme.
- **Project files that import deleted files.** Any project file under `src/` whose
  relative import resolves to a deleted served file is rewritten to the package
  specifier. This covers the project's own plugins and files added under `src/cms/`.
- **Glue and template files** (the entry and Vite patches, `style.css`, the
  middleware registry) change through the normal classification and merge.
- **The manifest** moves to schema 4, with bases for every file it writes.

## Order

1. `mergeText` with fixture tests: clean, conflict, CRLF, binary refusal, size limit.
2. Manifest schema 4: the base store, `writeManifest`, `refreshManifest` per-file
   bases (fixing the re-basing bug), unreferenced-blob cleanup, schema-3 reading.
3. Upgrade: the classification table, `--conflicts=markers`, the marker guard, plan
   JSON fields, `expected` set; the same merge in `buildPlan` for add and remove.
4. Plugins: bases in `.cossack/plugins.json`, merges in `cossack plugins upgrade`.
5. `cossack eject` (with `--restore` and `--diff`), the import rewrite, the `ejected`
   record, upgrade merges of ejected files, the framework's stale-override report.
   Needs `specs/package-routes.md`.
6. The served-CMS migration. Needs `specs/cms-served-app.md` steps 1-3. Verify on a
   copy of gif84 (expect: every served file deleted as package-equal, glue and
   facades written, its plugins untouched), then on gif84 itself after committing it.
7. Docs: `docs/upgrading.md` (new, covered below) and `docs/cossack-cli.md` (`upgrade`,
   `eject`, `plugins upgrade`).

## `docs/upgrading.md` (to write in step 7)

Version control and updates for any Cossack project, the CMS's included:

- **Commit:** `src/`, `content/`, `public/`, the configuration files,
  `.cossack/scaffold.json`, `.cossack/plugins.json` and `.cossack/base/`.
- **Never commit:** `node_modules`, `dist`, `.wrangler`, `storage/` (the RomeDB
  file and local media), secrets (`.dev.vars`, `.env`). The scaffold's `.gitignore`
  already does this.
- **Content is data, not code.** Back it up with site exports (`.romedb` or JSON),
  RomeDB Cloud, or a copy of `storage/romedb`. A seed script such as gif84's
  `content/` is for first installs.
- **Schema changes run themselves.** CMS host steps (`HOST_STEPS`,
  `packages/cms/src/server/host-schema.ts`) are append-only. They run when the host
  starts up and finds pending steps or changed collection declarations
  (`host.ts` around 2080-2100). Take a backup before deploying an upgrade. An older
  build refuses a database that has steps it lacks (`unknownHostSteps` and
  `hostSchemaMismatch`, `host-schema.ts` 301-312). So going back to an older
  version means restoring the backup together with the older code.
- **Workflow:**
  1. Make a branch.
  2. Run `cossack upgrade --dry-run`.
  3. Run `cossack upgrade --apply-template`.
  4. Resolve conflicts: `--conflicts=markers`, or by hand.
  5. Run the tests and check the overrides report.
  6. Deploy.

## Tests

- `scaffold/tests/merge.test.js`: `mergeText` cases.
- `cossack/tests/upgrade.test.js`: each class in the table; a clean merge; a
  conflict with and without markers; a second upgrade after a merge (no re-merge);
  schema 3 with and without a matching old render; the marker guard; unreferenced
  blobs removed.
- `cossack/tests/upgrade-release.test.js`: base reconstruction from a real old
  release; base release unavailable.
- `scaffold/tests/plugins.test.js`: a plugin upgrade merges a local edit.
- `cossack/tests/eject.test.js` (new):
  - eject a page, a layout and the default theme; typecheck and build;
  - upgrade against a changed package page: clean, then a conflict;
  - `--restore`; module paths refused; the route form `/search`.
- `cossack/tests/served-migration.test.js` (new): a fixture project at today's
  layout with
  - unchanged files,
  - stale hashes equal to the package,
  - an edited page,
  - an edited served module,
  - an edited `resources.ts`,
  - an edited default theme,
  - a project file importing `../cms/site`.

  Expect the rules above, and that the project builds after migrating.

## Not in this change

- Semantic merges (TypeScript AST). Line diff3 only.
- Automatic conflict resolution by an agent. The plan carries what one needs.
- Merges of `package.json`-like files beyond today's key-level merge.
