# The CMS package is an application

Status: implementing on branch `cms-foundation`, 2026-10-23.

The CMS pages, components, API routes and default theme lived in
`packages/scaffold/template` and reached a running application only through
`cossack create`/`cossack add cms`. Testing a change meant generating an app and
copying files into it. This spec moves that code into `packages/cms`, which
becomes a runnable Cossack application as well as a library, the way
`packages/framework` is.

## Decisions

- **One source for CMS application code.** `packages/cms/app/` is a Cossack
  application (Node adapter). The files the `cms` feature owns live there at the
  paths a generated project uses: `src/cms/`, `src/pages/dashboard/(cms)/`,
  `src/pages/(site)/`, `src/pages/auth/setup/`, `src/pages/api/cms/`,
  `src/pages/api/auth/`, `src/config/cms.ts`, `src/plugins/default-theme/`, and
  the FastDB storage modules that replace the database ones (`src/auth.ts`,
  `src/passkeys.client.ts`, `src/services/{users,roles,rbac}.ts`,
  `src/lib/permissions.ts`, `src/dashboard/access.ts`,
  `src/pages/dashboard/index.ts`). `template/cms-store` is gone. The library stays
  in `packages/cms/src`.
- **The scaffold copies from the package.** `packages/scaffold` depends on
  `@cossackframework/cms` and renders the `cms` feature's files from its `app/`
  folder. The list of owned paths is `packages/cms/app/cossack-recipe.json`,
  read as data; `isCmsPath` is derived from it. Adapter-specific files
  (`src/cms/media.ts`, `src/cms/pending.ts`), entry patches, wrangler bindings
  and environment values remain in `scaffold/src/cms-recipe.js`: they are glue
  between the application shell and the CMS, not CMS code.
- **The shared shell is rendered, not duplicated.** The CMS app also needs the
  files every generated project has (`App.ts`, the dashboard layout, auth pages,
  middlewares, `vite.config.ts`, …). Those stay in the scaffold template and are
  rendered into `packages/cms/app` by `pnpm --dir packages/cms/app run sync`,
  which `dev`, `typecheck` and `build` run first. The sync writes every file of
  the `node` + `cms` recipe whose capability is not `cms`, and never touches
  `.env`, `storage/` or plugins other than `default-theme`. Rendered files are
  gitignored; `app/.gitignore` is the inverse of the recipe manifest. Each file
  therefore has exactly one source: CMS code in `packages/cms/app`, shell code in
  `packages/scaffold/template`.
- **Workspace member.** `packages/cms/app` is `@cossackframework/cms-app`,
  private, with `workspace:*` dependencies, so the dashboard runs against the
  workspace sources of every package. Root `pnpm dev:cms` starts it, and starts
  a local FastDB first when nothing answers at `FASTDB_URL` in `.env`
  (`scripts/fastdb.sh`, also `pnpm fastdb` on its own).
- **Publishing.** `@cossackframework/cms` ships `src`, `app` and
  `agent-docs.json`; `app/.gitignore` keeps rendered files, `node_modules` and
  local state out of the tarball. The scaffold resolves
  `@cossackframework/cms/package.json` from its own dependencies, so the CLI
  renders the CMS version it was released with.

## Workflow after this change

- Edit a CMS page in `packages/cms/app/src/...`, reload the browser.
- Edit a shared page in `packages/scaffold/template/src/...`, run `sync` (the dev
  script does not watch the template), reload.
- `pnpm --dir packages/cms/app run typecheck` covers the CMS pages; the root
  `pnpm tsc --noEmit` does not (the app has its own `tsconfig.json`, as generated
  projects do).

## Tests

- `packages/scaffold/tests/cms-recipe.test.js`: unchanged expectations; files now
  come from the package. One new case: every manifest path exists in
  `packages/cms/app` and nothing under `scaffold/template` matches `isCmsPath`.
- `packages/cossack/tests/generated-runtime-cms*.test.js`: unchanged; linked
  apps already link `packages/cms`.
- `packages/cms/app`: `sync` then `tsc --noEmit` must pass; this replaces the
  rsync-into-an-installed-app check.

## Not in this change

- Route mounting from packages, so users import CMS pages instead of owning
  copies. Users keep receiving rendered source they can edit, as today.
- A watch mode that re-syncs the shell when the scaffold template changes.
