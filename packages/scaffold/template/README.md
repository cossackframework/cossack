# Cossack Framework

This project uses Cossack. Read the [documentation](https://cossack.dev/docs) to get started.

## Development

```sh
pnpm install
pnpm dev
```

Cloudflare projects with D1 apply pending migrations to the local Wrangler
database before the development server starts. Run `pnpm migrate` to apply them
without starting the server.

## Cloudflare database setup

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

For a Hyperdrive-backed project, create a Hyperdrive configuration for your
existing PostgreSQL or MySQL database, then replace the all-zero `id` in
`wrangler.jsonc` with that configuration's real ID. You can create the
configuration in the Cloudflare dashboard or with Wrangler. Keep the database
connection string and origin credentials in the Hyperdrive configuration in
Cloudflare. The Worker configuration only needs the opaque configuration ID. Do not
put the connection string or credentials in source-controlled files.
