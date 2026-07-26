# Cossack Framework

Welcome to the Cossack Framework! To get started, visit our [documentation](https://cossack.dev/docs).

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
