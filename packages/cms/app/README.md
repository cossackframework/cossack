# The CMS application

`@cossackframework/cms` is a library and an application. This folder is the application:
the `node` + `cms` recipe, run from the workspace. The files the `cms` feature owns are
tracked here and are what `cossack add cms` renders into a project; they are listed in
`cossack-recipe.json`. Every other file (the shared auth and dashboard shell, `vite.config.ts`,
entries, `.env.example`, …) comes from `packages/scaffold/template` and is written here by
`pnpm sync`, which `dev`, `build` and `typecheck` run first. Rendered files are gitignored, so
each file has one source: CMS code here, shell code in the scaffold template.

## Run

```sh
pnpm install            # once, at the repository root
pnpm dev:cms            # at the root; or `pnpm dev` here. Syncs the shell, serves http://localhost:3000
```

`pnpm sync` creates `.env` on the first run with `FASTDB_URL=http://127.0.0.1:4322`. When
nothing answers there, `dev` starts a local FastDB itself (`scripts/fastdb.sh`: uses
`$FASTDB_BIN`, `$COSSACK_TEST_FASTDB_BIN` or `fastdb` on `PATH`; the first start creates
`storage/fastdb/app.fastdb` and writes `FASTDB_TOKEN` into `.env`) and stops it with the dev
server; `pnpm fastdb` runs it on its own. Then open `/dashboard` and finish the setup with
`CMS_SETUP_CODE` from `.env`. Change `PORT` in `.env` when 3000 is taken, and the port in
`FASTDB_URL` when 4322 belongs to another app.

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
one with the CMS, add it to `cossack-recipe.json` and un-ignore it in `.gitignore`.
