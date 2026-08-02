# SQLite starter

This example demonstrates the complete ORM lifecycle:

1. Create an empty SQLite database.
2. Apply a versioned migration.
3. Seed `User` and `Post` records through Active Record models.
4. Load both sides of their relationship and print the result.

## Run the complete workflow

From the repository root:

```sh
pnpm example:sqlite
```

The command intentionally refuses to overwrite an existing database. To run the
workflow again, use:

```sh
pnpm example:sqlite:reset
```

Reset is recoverable: the previous database is moved to a timestamped `.backup`
file under `.data/`.

## Run each stage separately

```sh
pnpm example:sqlite:create
pnpm example:sqlite:migrate
pnpm example:sqlite:seed
pnpm example:sqlite:query
```

The final stage can also be executed directly:

```sh
pnpm exec tsx ./examples/sqlite-starter/query.ts
```

The seeder is idempotent, so running it more than once does not duplicate users
or posts. It is declared with `defineSeeder()` and executed by `SeederRunner`;
`seed.ts` is only the executable entry point. Framework CLIs should load the
same configured seeder list and delegate execution to `SeederRunner`.

The included `orm.config.ts` also works with the ORM CLI during development:

```sh
pnpm exec tsx ./src/cli.ts migration status \
  --config ./examples/sqlite-starter/orm.config.ts
pnpm exec tsx ./src/cli.ts schema check \
  --config ./examples/sqlite-starter/orm.config.ts
pnpm exec tsx ./src/cli.ts seed list \
  --config ./examples/sqlite-starter/orm.config.ts
pnpm exec tsx ./src/cli.ts seed run \
  --config ./examples/sqlite-starter/orm.config.ts
```

Seeders run sequentially in configuration order. The default `transaction:
"auto"` gives each seeder its own transaction when the adapter supports
interactive transactions and runs without one on adapters such as D1. Use
`"required"` when partial writes are unacceptable, or `"none"` when a seeder
must manage a database-specific atomic operation itself.

## Structure

```text
sqlite-starter/
├── models/
│   ├── User.ts
│   └── Post.ts
├── migrations/
│   └── 0001_create_users_and_posts.ts
├── seeders/
│   ├── database.seeder.ts
│   └── index.ts
├── create-database.ts
├── migrate.ts
├── seed.ts
├── query.ts
├── run.ts
└── orm.config.ts
```

The example imports the ORM source directly so it runs in this repository
without a publish step. In an application, use `@cossackframework/database` and
`@cossackframework/database/node` instead.
