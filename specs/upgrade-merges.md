# Upgrades: one command that merges, and ejected overrides

Status: built 2026-11-15. Part 3 of 4, after `specs/package-routes.md` and
`specs/cms-served-app.md`; `specs/cms-updates.md` follows. Steps 1 to 4 do not depend on them and can be built first.

Update (2026-11-15): no project records its scaffold files any more
(`specs/cms-served-app.md`, "Update 2"; `specs/dashboard-package.md`), so the merge
of scaffold files, its classification, `--force` and `--force-file` are removed.
What remains of this spec: the stored texts and the merge for `cossack eject`
copies and plugins, `--conflicts=markers`, and the refusal of a copied CMS.

## Why

`cossack upgrade` updates a scaffolded file only when the project never edited it.
An edited file is skipped for good, or overwritten with `--force-file`, losing the
edits. Once the CMS is served from its package, what stays in a project is glue,
the template shell (layouts, `list-table`, entry files) and overrides. Those still
need upgrades that keep local edits.

The goal is one command. `cossack upgrade` updates the packages, installs, and
merges the project's owned files. A user never looks for files to copy.

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
## Decisions

### Merge bases are stored, not rebuilt

- **Content-addressed base store.** `.cossack/base/<sha256>` holds the upstream text of each owned file as last written or merged.
  - Manifest schema 4: `files: { <path>: { capability, hash, base } }`. `hash` is the file on disk after the operation; `base` is the upstream content it descends from.
  - A verbatim write sets `base = hash`. A preserved file keeps its base. A merge sets `base` to the new upstream.
  - Blobs no manifest references are deleted on every manifest write.
  - The store is committed: a fresh clone must be able to merge. The scaffold's `.gitignore` leaves it in. The scaffold also writes a `.gitattributes`, which it has none of today, with `.cossack/base/** -diff linguist-generated`.
  - Rebuilding a base from a release was rejected. Linked and unpublished packages cannot be rendered by version, it needs the network, and the global `templateVersion` already drifts (see the bug above).
- **Schema-3 manifests have no bases.** Old releases are not rendered to rebuild
  them. A file whose hash equals the recorded hash is `canUpdate` as today, and it
  gets a base when it is written. An edited file is `noBase`: kept and reported,
  and replaced only with `--force-file`. This is an alpha break, by decision.
- **`dependencyBaseline`** keeps its own key-level merge. `package.json` and the other `EXCLUDE_FROM_SYNC` files are unchanged by this spec.

### One command

- **`cossack upgrade` does everything by default:** it moves the
  `@cossackframework/*` dependencies to the target release (`--tag`, default
  `latest`), installs, then updates and merges owned files, ejected files and
  installed plugins. `--apply-template` is removed.
- **`--dry-run`** prints the same plan and writes nothing.
- **Nothing a user edited is lost without a flag.** Clean merges are written.
  Conflicting files are left as they are and listed with the next command to run.
  The command exits 0 with conflicts listed, and `--json` carries them, so a
  pipeline can open a pull request (`specs/cms-updates.md`).
- **`pnpm up` alone still works** for a release that changes only served code. If
  the release needs newer project files, the build stops with
  `COSSACK_PACKAGE_HOST_OUTDATED` and names `cossack upgrade`
  (`specs/package-routes.md`). The docs teach `cossack upgrade` only.

### Classification and flags

Each owned file has *ours* (the file on disk), *base* (the stored blob) and *theirs* (the target render).

| Case | Class | What `cossack upgrade` does |
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

### Projects with a copied CMS are not migrated

There is no migration from the copied CMS to the served one. This is an alpha
break, by decision: gif84 is the only such project, and it is a test project.

- `cossack upgrade` refuses a project whose manifest owns `src/cms/index.ts`, with
  `COSSACK_UPGRADE_CMS_COPIED` and a link to the docs.
- The way forward is a new project: `cossack create --features cms`, then copy the
  project's plugins, `content/`, seed scripts and settings into it.
- gif84 is rebuilt this way. It is the acceptance test that a real site needs only
  plugins, `cms.config.ts` and content.

## Order

1. `mergeText` with fixture tests: clean, conflict, CRLF, binary refusal, size limit.
2. Manifest schema 4: the base store, `writeManifest`, `refreshManifest` per-file
   bases (fixing the re-basing bug), unreferenced-blob cleanup, schema 3 without bases.
3. Upgrade: apply by default and `--dry-run`, the classification table, `--conflicts=markers`, the marker guard, plan
   JSON fields, `expected` set; the same merge in `buildPlan` for add and remove.
4. Plugins: bases in `.cossack/plugins.json`, merges in `cossack plugins upgrade`.
5. `cossack eject` (with `--restore` and `--diff`), the import rewrite, the `ejected`
   record, upgrade merges of ejected files, the framework's stale-override report.
   Needs `specs/package-routes.md`.
6. Rebuild gif84 on the served CMS as a new project. Needs
   `specs/cms-served-app.md` steps 1-3. Expect `src/` to hold only glue, facades,
   `cms.config.ts` and its two plugins, and the Lighthouse score to stay at 97.
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
  2. Run `cossack upgrade` (`--dry-run` first to preview).
  3. Resolve conflicts, if it lists any: `--conflicts=markers`, or by hand.
  4. Run the tests and check the overrides report.
  5. Deploy.

  The dashboard's Update button runs the same steps in the project's pipeline
  (`specs/cms-updates.md`).

## Tests

- `scaffold/tests/merge.test.js`: `mergeText` cases.
- `cossack/tests/upgrade.test.js`: each class in the table; a clean merge; a
  conflict with and without markers; a second upgrade after a merge (no re-merge);
  a schema-3 manifest (edited file is `noBase`); a copied-CMS project is refused;
  the marker guard; unreferenced blobs removed; the default run applies, and
  `--dry-run` writes nothing.
- `scaffold/tests/plugins.test.js`: a plugin upgrade merges a local edit.
- `cossack/tests/eject.test.js` (new):
  - eject a page, a layout and the default theme; typecheck and build;
  - upgrade against a changed package page: clean, then a conflict;
  - `--restore`; module paths refused; the route form `/search`.
## Not in this change

- Semantic merges (TypeScript AST). Line diff3 only.
- Migrating a project that holds a copied CMS.
- Automatic conflict resolution by an agent. The plan carries what one needs.
- Merges of `package.json`-like files beyond today's key-level merge.
