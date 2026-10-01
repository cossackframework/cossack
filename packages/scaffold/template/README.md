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

Before deploying a D1-backed project, create the production database with
`pnpm exec wrangler d1 create <database-name>` and replace the placeholder
`database_id` in `wrangler.jsonc`.
