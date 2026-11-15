# The dashboard application

The sign-in pages and the dashboard of `@cossackframework/dashboard`, as an application.

- A project with `auth` or `dashboard` on the database ORM mounts this folder's `src`
  from the package (`package.json#cossack.packages`). `cossack-recipe.json` lists the
  served paths.
- The source of every file is `packages/scaffold/template`. `pnpm sync` writes this
  folder from it: edit the template, then sync. `pnpm pack` syncs first.
- `pnpm dev:dashboard` runs it as a Node application on SQLite. The models,
  migrations and seeders here are the development application's own; a project has
  its own copies.
