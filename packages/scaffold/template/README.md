# Cossack Framework

This project uses Cossack. Read the [documentation](https://cossack.dev/docs) to get started.

## Development

```sh
pnpm install
pnpm dev
```

<!-- @cossack:d1 -->
Pending migrations are applied to the local Wrangler database before the
development server starts. Run `pnpm migrate` to apply them without starting
the server.

<!-- /@cossack:d1 -->
<!-- @cossack:cms -->
## CMS

The site's content lives in RomeDB.
<!-- @cossack:cloudflare -->
`pnpm dev` starts a local RomeDB service for a database under `storage/`, so
the `romedb` program must be on your PATH. A deployed Worker reaches RomeDB
Cloud: set `ROMEDB_URL` and the `ROMEDB_TOKEN` secret (see `.dev.vars.example`).
<!-- /@cossack:cloudflare -->
<!-- @cossack:node -->
By default the database is the file `ROMEDB_URL` names in `.env`, opened by
the server itself. To use a RomeDB service or RomeDB Cloud, set `ROMEDB_URL`
to its address and `ROMEDB_TOKEN` to its token.
<!-- /@cossack:node -->

On the first run, open `/auth/setup`, enter the `CMS_SETUP_CODE` from your
local environment file and create the administrator. The dashboard is at
`/dashboard`; the site's theme is the plugin in `src/plugins/default-theme/`.
Read the [CMS guide](https://cossack.dev/docs/cms) for collections, blocks,
themes and plugins.

<!-- /@cossack:cms -->
<!-- @cossack:cloudflare-database -->
## Cloudflare database setup

<!-- /@cossack:cloudflare-database -->
<!-- @cossack:d1 -->
For a D1-backed project, the generated `wrangler.jsonc` sets `database_name`
to the project name followed by `-db`. It leaves `database_id` unset so local
development can use Wrangler's local D1 database. Cloudflare's Wrangler
configuration requires both `database_name` and `database_id` for a remote
binding. `cossack check cloudflare` reports the missing ID before deployment.

For a new remote database, run this from the project directory. It creates a
Cloudflare resource and updates `wrangler.jsonc` with its ID:

```sh
pnpm exec wrangler d1 create my-cossack-app-db --update-config --binding DB
```

Replace `my-cossack-app` with your project name. This command acts on remote
D1 and creates a new database. To use an existing database instead, run
`pnpm exec wrangler d1 list`, copy its ID into `database_id`, and keep
`database_name` matched. Add `--env <ENV>` to the create command when targeting
a named Wrangler environment. Do not add a placeholder `database_id`. Run
`pnpm migrate` to apply migrations to the local D1 database during development.
<!-- /@cossack:d1 -->
<!-- @cossack:hyperdrive -->
For a Hyperdrive-backed project, create a Hyperdrive configuration for your
existing PostgreSQL or MySQL database, then replace the all-zero `id` in
`wrangler.jsonc` with that configuration's real ID. You can create the
configuration in the Cloudflare dashboard or with Wrangler. Keep the database
connection string and origin credentials in the Hyperdrive configuration in
Cloudflare. The Worker configuration only needs the opaque configuration ID. Do not
put the connection string or credentials in source-controlled files.
<!-- /@cossack:hyperdrive -->
