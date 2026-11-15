# The CMS application

`@cossackframework/cms` is a library and an application. This folder is the application:
the `node` + `cms` recipe, run from the workspace.

A project does not get a copy of these files. It mounts them from the package: the `cossack`
field of `../package.json` lists what the package serves (pages, the default theme,
configuration), and the project names the package in its own `package.json`
(`cossack.packages`). So the files tracked here are the CMS that every project runs.
`cossack-recipe.json` lists them in three groups:

- `served`: mounted by the project, never copied;
- `facades`: served modules that the dashboard shell imports by relative path; the project
  holds a one-line re-export for each;
- `rendered`: written into the project by the scaffold (`packages/scaffold/src/cms-recipe.js`):
  the storage glue per runtime and `src/cms.config.ts`.

Every other file here (the shared auth and dashboard shell, `vite.config.ts`, entries,
`.env.example`, …) comes from `packages/scaffold/template` and is written by `pnpm sync`,
which `dev`, `build` and `typecheck` run first. Rendered files are gitignored, so each file
has one source: CMS code here, shell code in the scaffold template. This folder mounts
nothing: it is the package's served source itself.

## The host contract

Served code reaches the project only through `@/…` imports, and `../package.json` lists those
modules in `cossack.host`. Every other import is relative and stays inside the served files, or
names a package. `tests/host-contract.test.ts` holds this:

- import a project module (`@/dashboard/list-table`, `@/cms.config`) through `@/`, and add a new
  one to `cossack.host`;
- import another CMS file by relative path;
- import the CMS core as `@cossackframework/cms`, never by a path into `../src`.

When served code starts to need something new from a project file, raise
`cossack.hostTemplate` in the same commit: projects on an older template then get a clear
"run cossack upgrade" at build time.

## Run

```sh
pnpm install            # once, at the repository root
pnpm dev:cms            # at the root; or `pnpm dev` here. Syncs the shell, serves http://localhost:3000
```

`pnpm sync` creates `.env` on the first run with `ROMEDB_URL=storage/romedb/app.romedb`: the
dev server opens that RomeDB file in its own process and creates it on the first start, so no
service, port or token is needed. Only one process can own the file. To share a live database
with RomeDB Studio, set `ROMEDB_URL` to a loopback URL such as `http://127.0.0.1:4323`: `dev`
then starts `romedb serve` for the same file (`$ROMEDB_BIN` or `romedb` on `PATH`), reads its
token from `storage/romedb/token` and stops it with the dev server; nothing is copied into
`.env`. Then open `/dashboard` and finish the setup with `CMS_SETUP_CODE` from `.env`. Change
`PORT` in `.env` when 3000 is taken.

`pnpm typecheck` here is the type check for the CMS pages; the root `pnpm tsc --noEmit` does
not cover them.

## Editing

- A CMS page or component: edit it here, reload the browser.
- A shared page (login, dashboard layout, users): edit `packages/scaffold/template`, run
  `pnpm sync`, reload.
- Dependencies: `sync` rewrites this `package.json`'s dependency sections from the recipe, with
  workspace packages as `workspace:*`. Commit the result after `pnpm install`.

## Plugins and themes

Everything under `src/plugins/` except `default-theme` is ignored by git and left alone by
`sync`, so a plugin or theme under development can be rendered or symlinked there. To ship
one with the CMS, add it to `served` in `cossack-recipe.json`, to `cossack.plugins` in
`../package.json`, and un-ignore it in `.gitignore`.
