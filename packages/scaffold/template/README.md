# Cossack Framework

This project uses Cossack. Read the [documentation](https://cossack.dev/docs) to get started.

## Development

```sh
pnpm install
pnpm dev
```

Cloudflare projects with D1 apply pending migrations to the local Wrangler
database before the development server starts. Run `pnpm migrate` whenever you
want to apply them without starting the server.

## Cloudflare database setup

For a D1-backed project, the generated `wrangler.jsonc` sets `database_name`
to the project name followed by `-db` and does not include a remote database
ID. Create a remote D1 database with that exact name before deploying. For the
default project name, run:

```sh
pnpm exec wrangler d1 create my-cossack-app-db
```

Replace `my-cossack-app` with your project name. If the database already
exists, keep its name matched to `database_name` in `wrangler.jsonc`. Wrangler
4.114.0 resolves this configured name to a database in your account and fails
deployment if that database does not exist. Do not add a placeholder
`database_id`. Local development uses Wrangler's local D1 database; run
`pnpm migrate` to apply migrations locally.

For a Hyperdrive-backed project, create a Hyperdrive configuration for your
existing PostgreSQL or MySQL database, then replace the all-zero `id` in
`wrangler.jsonc` with that configuration's real ID. You can create the
configuration in the Cloudflare dashboard or with Wrangler. Keep the database
connection string and origin credentials in the Hyperdrive configuration in
Cloudflare; the Worker config only needs the opaque configuration ID. Do not
put the connection string or credentials in source-controlled files.
