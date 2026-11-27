# Cossack reports

## 0.9.2 CMS on Workers: a burst of requests can leave a site's database client full for good ("Client request limit reached")

**Found in:** ACME, as a CMS project with one plugin (`~/Sites/acme`, branch `cms-plugin`), on the local Workers dev server with local `romedb serve` (2026-11-19). Not yet seen on a deployment: ACME is not deployed.

**What happened:** One RomeDB client serves every request to a site in an isolate, and allows 32 requests in flight (`@romedb/client` 0.2.24, `#active`). After dropped requests and a burst of requests to one site at once, the site answered 500 on every later request: `[cms] could not load collections ClientError: Client request limit reached` from `CmsHost.#loadDefinitions`, and the same on every read after it. It did not recover until the dev server restarted. Counting `fetch` calls of the database connection showed 32 that never settled, all started by `GET /dashboard/...` requests of that site.

**How to reproduce (in ACME):** `pnpm dev`, `pnpm seed`, then drop about 700 requests to a signed-in dashboard page of one site before their answer (delays of 5 to 300 ms), then send 20, 60 and 150 requests at once, then one request. Remove `fetch: requestFetch` and the `requestLifetime` middleware first (`src/cms.config.ts`, `src/bootstrap/middlewares.ts`); with them the site recovers. `scripts/abort-requests.ts` does the drops and the bursts.

**What I think happens (not proven in the runtime):** a database call gives its place back when its promise settles. A call whose request ends first never settles: the visitor left, or the request failed while other reads of the same `Promise.all` were in flight (`cmsMiddleware` reads three settings at once; `#loadDefinitions` reads at once too). Once the client refuses a call for lack of places, that request fails and strands more calls, so the fault feeds itself.

**Also:** with no dropped requests at all, 60 requests at once to one site gave some 500 answers (they recover). Each request makes several reads in flight at once, so about ten concurrent requests reach the limit of 32.

**Expected:** a site keeps serving after a burst. For example: the CMS passes the request's AbortSignal to its database calls, does not start reads at once that it could read in one statement, and replaces a client that reports `RDB_LIMIT` with outcome `not-sent`. The main site's client cannot be replaced from outside the CMS (`network.release()` refuses `main`).

**Workaround in ACME:** `src/request-fetch.ts`: the database connections of `storage` get a `fetch` that carries a signal of the current request; a first global middleware aborts it when the visitor leaves or the answer is 5xx, then probes the site's client with `SELECT 1` and calls `network.release(site.database)` when it answers `RDB_LIMIT` / `not-sent`. With it, a restaurant recovered every time in the test above. The main site is not covered.

**Status:** Fixed. A site keeps serving after dropped requests and a burst:

- On Workers, the CMS ends a request's database calls when its visitor leaves or the
  request fails (`cancelsRequestIo` in `cloudflareStorage`). Work after the answer (the
  outbox, maintenance) gets no signal.
- A cached read shared between requests is read again, once, when the request that started
  it ended (`settings.all()`, `network.resolve()`, `network.enabled()`, `host.ready()` and
  the host's activation state).
- The middleware reads the settings once, and collections and taxonomies are read in one
  request.
- If calls are stranded anyway, the client gives their places back once their deadline
  passes (`@romedb/client` 0.2.26 and later), for added sites and the main site alike. A full
  client makes a burst wait and try again instead of failing.
- Found on the way: a failed site lookup served the main site at another site's address; it
  now answers 503. A failed read no longer turns the network off for 30 seconds, and a
  failed policy read no longer opens the network policy.

Docs: `packages/romedb/README.md` ("Requests that end early"), `docs/cms/index.md`. Tests:
`packages/romedb/tests/places.test.ts`, `packages/cms/tests/request-calls-unit.test.ts`.
ACME's `requestFetch`, the `requestLifetime` middleware and its client replacement can go.

## 0.9.3 `cossack upgrade` cannot take a CMS project from 0.9.2 to 0.9.3

**Found in:** GIF84 (`~/Sites/gif84-cossack-cms`), a CMS project on Workers with RomeDB, linked to this checkout at 0.9.3 plus `c5c552bd` (2026-11-25). Its `package.json` declared `^0.9.2` and `cossack.template` `0.9.2`.

There are two faults. The first stops the upgrade. The second would leave the project broken if the upgrade ran.

### 1. The upgrade stops: `Unknown database provider "romedb"`

**What happened:** `pnpm exec cossack upgrade --dry-run` prints only `Unknown database provider "romedb". Supported values: d1, sqlite, turso, postgres, mysql, hyperdrive-postgres, hyperdrive-mysql` and exits 1. With `--json` the diagnostic is `COSSACK_COMMAND_FAILED` with no cause.

**Cause (read in the source):** `upgradeCommandInner` (`packages/cossack/src/commands/upgrade.js`) reads the recipe with the installed 0.9.3 `readManifest`, which gives a CMS project `config.database: "romedb"`. It then loads the scaffold of the declared release (0.9.2) and calls that release's `resolveRecipe` with this recipe, to render what 0.9.2 owned. The 0.9.2 `DATABASE_PROVIDERS` (`packages/scaffold/src/registry.js` at `bc8b21cf`) has no `romedb`: the provider came with 0.9.3. So the baseline cannot be rendered for any CMS project that declares 0.9.2 or earlier.

**How to reproduce:** in a CMS project whose `@cossackframework/framework` is `^0.9.2`, with 0.9.3 installed, run `cossack upgrade --dry-run`.

**Expected:** the upgrade plans the dependency changes. For example: read the recipe for the baseline with the baseline release's own reading of the project, or leave out a `database` value that the baseline release does not know and let it take its default. The error should also say which release refused the recipe.

### 2. The CMS package does not tell a 0.9.2 project what 0.9.3 needs of its files

**What happened:** with the dependencies at 0.9.3, `cossack typecheck` gave 123 errors, all in `packages/cms/app/src` (`Cannot find module '@/orm/factory'`, `'@/models/User'`, and the errors that follow from them). 0.9.3 (`97db33e2`) moved sign-in, accounts and roles to the dashboard package, so the served CMS code now imports the project's ORM factory and account models.

**Cause:** `packages/cms/package.json` adds `orm/factory.ts` and sixteen `models/*.ts` to `cossack.host`, but `hostTemplate` is still `0.9.0` and there are no `hostSteps`. So `hostContractProblems` and the upgrade see nothing to report for a project at template 0.9.0 to 0.9.2. The upgrade would write the missing `host` files, but they are not enough on their own: `src/orm/factory.ts` imports `../migrations` and `../models`. A 0.9.2 project also lacks these, and none is in `host`:

- `orm.config.ts`, `src/orm/tooling.ts`
- `src/models/index.ts`, `src/models/CacheItem.ts`
- `src/migrations/` (nine migrations and `index.ts`), `src/seeders/`
- `src/middlewares/orm.ts`, and `ormRequestMiddleware` before `cmsMiddlewares` in `src/bootstrap/middlewares.ts`
- the `migrate` and `schema:check` scripts (the dependencies `@cossackframework/database` and `reflect-metadata` are the recipe's, so the upgrade would add those)

**Expected:** `hostTemplate` of `@cossackframework/cms` is `0.9.3`, with `hostSteps` for 0.9.3 that list the files and the middleware line above, so the upgrade and the build name them. The upgrade could write the new files itself, since the project has none of them. `docs/upgrading.md` ("Changes in 0.9.3") says the CMS's account tables are dropped but not that the project needs these files.

**Workaround in GIF84:** rendered the 0.9.3 recipe with the local scaffold (`resolveRecipe` and `renderRecipe`, cloudflare, `features: ['cms']`, `database: 'romedb'`), copied the files above into the project, added the two dependencies and two scripts, and set the versions and `cossack.template` to 0.9.3 by hand. Typecheck, `check routes`, `check templates` and `vite build` then pass. Not tested: a running server, and the migrations against a database.

**Status:** Fixed.

1. The upgrade renders what the declared release owned with that release's own reading of the
   recipe (its `readManifest`), so a default that a later release added does not reach it. A
   release that refuses the recipe is named: `COSSACK_UPGRADE_RECIPE_REFUSED`, "Cossack 0.9.2
   cannot render this project's recipe: ...".
2. `@cossackframework/cms` and `@cossackframework/dashboard` ask for template 0.9.3, with
   `hostSteps` for 0.9.3. The CMS's steps are the middleware line, the two scripts, the account
   files, and a new first account at `/auth/setup`. The dashboard's steps are the models,
   migrations, factory, seeder and middleware of auth and dashboard projects, which changed in
   0.9.3 too. A package's new `cossack.hostFiles` names the files a template adds. The upgrade
   writes those the project lacks, and a folder only when the project has none (CMS:
   `orm.config.ts`, `src/orm/`, `src/models/`, `src/migrations/`, `src/seeders/`,
   `src/middlewares/orm.ts`). `cossack typecheck` now stops with the steps
   (`COSSACK_PACKAGE_HOST_OUTDATED`) before `tsc`, as the build does.

Checked on a copy of GIF84's committed tree set to 0.9.2 and linked to this checkout. The
upgrade planned and installed the dependencies (adding `@cossackframework/database` and
`reflect-metadata`), wrote the 34 files, and listed the two manual steps. After those steps,
typecheck, `check routes`, `check templates` and `vite build` passed. A copy that declares 0.9.0
is refused by name: published 0.9.0 has no `cms` feature, since GIF84 was built against linked
sources. Not tested: a running server and the migrations against a database. Docs:
`docs/upgrading.md` ("Changes in 0.9.3"), `docs/routing.md`, `docs/cossack-cli.md`. Tests:
`packages/cossack/tests/upgrade.test.js`, `packages/cossack/tests/typecheck-host.test.js`,
`packages/framework/tests/package-mounts.test.ts`.
