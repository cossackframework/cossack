# Create Cossack App

This package provides a command-line interface (CLI) tool for creating new Cossack applications. It sets up a new project with the necessary dependencies and configuration to get you started quickly with the Cossack Framework.

## Usage

To create a new Cossack application, run the following command:

```sh
npx create-cossack-app@latest my-app
```

This will prompt you to choose the run-time environment for your application (Cloudflare Workers or Node.js) and set up the project accordingly. You can always change it later by modifying the `package.json` and installing the appropriate adapter package.

This will create a new directory called `my-app` with a basic Cossack application structure. You can then navigate into the directory and start the development server:

```sh
cd my-app
pnpm install
pnpm run dev
```

## What's included

The scaffolded project is an opinionated starting point — it works out of the box and includes sensible defaults so you can start building immediately.

### Database (Kysely + D1/Turso)

Every new project ships with database support pre-wired:

- **`@cossackframework/database`** — a Kysely-based query builder with D1 and Turso (libSQL) dialects.
- **`src/db/config.ts`** — the client factory. D1 for Cloudflare projects, local SQLite (`better-sqlite3`) for Node.js projects.
- **`src/middlewares/db.ts`** — the `dbMiddleware` (exposes `c.get('db')` / `db()`) and the database cache driver registration.
- **`src/bootstrap/middlewares.ts`** — `dbMiddleware` is registered by default.
- **`src/config/database.ts`** — database config (default connection, driven by `DB_CONNECTION` env var).
- **`src/migrations/`** — 6 starter migrations: `users`, `sessions`, `roles`, `permissions`, `oauth_accounts`, `cache_items`.
- **`src/seeders/database.seeder.ts`** — a blank seeder stub.
- **`src/models/User.ts`** — a typed `UserRow` with `Database` schema augmentation.
- **`wrangler.jsonc`** — a D1 binding (`DB`) is included for Cloudflare projects.

**Runtime defaults:**
- **Cloudflare Workers** — D1 binding (`env.DB`). Replace `<database_id>` in `wrangler.jsonc` after running `npx wrangler d1 create <name>`.
- **Node.js** — local SQLite file (`./database.sqlite`, configurable via `DB_PATH`). No external database server required.

### Cache

The cache system (in-memory by default) is built into the framework. The `'database'` cache driver is pre-registered in `src/middlewares/db.ts` — set `CACHE_DRIVER=database` to use D1/Turso-backed caching. The `cache_items` table ships as migration `0006_create_cache_table.ts`.

## Swapping or removing the database

The framework itself does **not** hard-depend on `@cossackframework/database` — the database layer lives in the project template, not in the framework package. This means you can swap it out cleanly:

- **Use Drizzle instead of Kysely** — remove `@cossackframework/database`, rewrite `src/db/config.ts` and `src/middlewares/db.ts` to use Drizzle, and keep the `dbMiddleware` pattern (set `c.set('db', client)` and scope via your own ALS if you want the `db()` helper).
- **Use SurrealDB, Postgres, or another database** — same approach. The migrations and seeders are Kysely-specific, so replace them with your own tooling (e.g. `drizzle-kit`, raw SQL, etc.).
- **No database at all** — remove `@cossackframework/database` from `package.json`, remove `dbMiddleware` from `src/bootstrap/middlewares.ts`, delete `src/db/`, `src/migrations/`, `src/seeders/`, and the `database` store from `src/config/cache.ts`. The framework runs fine without a database.

> The `'database'` cache driver throws a helpful error if used without registration. If you remove the database package, either remove the `'database'` store from `config/cache.ts` or register your own driver via `extendCacheDriver('database', () => yourStore)`.

## Opinions & defaults

The template makes these opinionated choices so most users never need to configure anything:

| Choice | Default | How to change |
|--------|---------|---------------|
| Query builder | Kysely (re-exported from `@cossackframework/database`) | Swap `src/db/config.ts` + `src/middlewares/db.ts` |
| Default dialect (Cloudflare) | D1 | Set `DB_CONNECTION=turso`, swap `src/db/config.ts` for the Turso variant |
| Default dialect (Node.js) | Local SQLite (`better-sqlite3`) | Set `DB_PATH`, or swap `src/db/config.ts` |
| Cache driver | In-memory (`memory`) | Set `CACHE_DRIVER=kv\|database\|durable-object` |
| Database cache driver | Registered in `src/middlewares/db.ts` | Remove or replace with `extendCacheDriver()` |
| Migrations folder | `src/migrations/` | Configurable via `runMigrations({ folder })` |
| Seeders folder | `src/seeders/` | Configurable via `runSeeders({ folder })` |
