# @cossackframework/dashboard

The sign-in pages and the dashboard of a Cossack project on the database ORM, served from
this package. A project with the `auth` or `dashboard` feature mounts it, so the project
holds no copy of these pages and gets their fixes with `cossack upgrade`.

```bash
cossack add auth
```

```bash
cossack add dashboard
```

The project lists the package in `package.json#cossack.packages` and keeps:

| File | What it holds |
| --- | --- |
| `src/dashboard.config.ts` | Sign-in methods, OAuth providers, dashboard modules, the project's own screens in the navigation, where to go after sign-in. |
| `src/models/`, `src/migrations/`, `src/seeders/` | The schema: users, sessions, roles, OAuth accounts. |
| `src/stores.client.ts` | The project's client stores. |

The package serves `/auth/*` and `/dashboard/*`, with `auth.ts`, the user and role services
and the dashboard kit behind them. A file at the same path under the project's `src/pages/`
replaces a served page, and `cossack eject dashboard <path>` copies one into the project.

See the [authentication guide](https://github.com/cossackframework/cossack/blob/master/docs/authentication.md)
and [routing: pages from a package](https://github.com/cossackframework/cossack/blob/master/docs/routing.md).
