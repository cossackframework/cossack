---
title: "Testing"
description: "Run TypeScript type checking and Playwright end-to-end tests for framework changes."
---

# Testing

## Running Tests

### Type Checks

For this monorepo, build package dependencies first, then run the type check for
every TypeScript package explicitly. Root `tsc --noEmit` alone does not traverse
project references:

```bash
pnpm build
pnpm typecheck
```

### Unit Tests

```bash
pnpm test:unit
```

This runs every package with a unit suite once, including core, renderer,
auth, UI, adapters, database, Studio, scaffold, CLI, and framework. The
`test-utils` package includes browser lifecycle and server request helpers and
is included. For watch mode or a
focused test, use `pnpm --filter <package-name> exec vitest <test-file>`.

See [Test utilities](./test-utils.md) for internal browser hydration and awaitable
cleanup helpers, production fetch/RPC dispatch, credential fixtures, and
controlled asynchronous work.

### Database Live Tests

The database package runs its ORM tests against real engines in
`packages/database/test/live-dialects.test.ts`. SQLite, embedded Turso and
local D1 (Miniflare) always run. PostgreSQL and MySQL run only when a
connection URL is set, and skip otherwise:

```bash
COSSACK_TEST_POSTGRES_URL=postgres://cossack:cossack@127.0.0.1:5432/cossack_test \
COSSACK_TEST_MYSQL_URL=mysql://root:cossack@127.0.0.1:3306/cossack_test \
pnpm --filter @cossackframework/database run test --watch=false
```

Point both URLs at disposable databases: the tests drop and create their own
`live_*` and `rt15_*` tables. Set `COSSACK_TEST_REQUIRE_LIVE=1` as well to make
a missing URL fail the run instead of skipping both engines.

To start the same servers that CI uses with Docker:

```bash
docker run -d --name cossack-postgres -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=cossack -e POSTGRES_PASSWORD=cossack -e POSTGRES_DB=cossack_test \
  postgres:18.6
docker run -d --name cossack-mysql -p 127.0.0.1:3306:3306 \
  -e MYSQL_ROOT_PASSWORD=cossack -e MYSQL_DATABASE=cossack_test -e TZ=Asia/Bangkok \
  mysql:8.0.46
```

The MySQL server runs in UTC+7 on purpose. The MySQL adapter must still store
and read UTC values. The Hyperdrive MySQL target cannot set the session time
zone, so it skips its `DEFAULT CURRENT_TIMESTAMP` test on that server
(see `packages/database/docs/models.md`).

Studio reads the same variables. `packages/studio/tests/live-introspection.test.ts`
creates its own `sl_*` tables and views, checks that a schema load runs a fixed
number of queries, and compares the result with the pinned JSON files in
`packages/studio/tests/__snapshots__/`. The Playwright spec
`packages/studio/e2e/mysql-definition.spec.ts` needs `COSSACK_TEST_MYSQL_URL`
and a Studio build:

```bash
pnpm --filter @cossackframework/studio run test --watch=false tests/live-introspection.test.ts
pnpm --filter @cossackframework/studio exec playwright test e2e/mysql-definition.spec.ts
```

The `database-live` job in `.github/workflows/integration-tests.yml` runs the
database tests and these Studio tests with PostgreSQL and MySQL service
containers and `COSSACK_TEST_REQUIRE_LIVE=1`. Like the other integration jobs,
it runs on pull requests that change packages, on pushes to master, nightly and
before every release.

The framework's SSG output checks require `pnpm --filter
@cossackframework/framework build:ssg` first. Without those artifacts, the six
output checks are skipped. CI runs the SSG browser and artifact checks in a
separate step. SSG browser tests use the separate
`pnpm --filter @cossackframework/framework test:e2e:ssg` command.

### E2E Tests

The framework uses Playwright for end-to-end testing. Tests are located in `packages/framework/e2e/`.

```bash
# Run e2e tests
pnpm --filter @cossackframework/framework test:e2e
```

The default run builds the production app and starts `vite preview`. Playwright
shows build progress while it waits for the server. Later runs reuse the build
when its inputs have the same contents. Rebuilding identical workspace packages
does not trigger another application build. Changed source, configuration,
dependencies, or build environment values invalidate this cache.

The server launcher limits each readiness request to one second. This prevents
a closed localhost port from delaying startup for minutes on WSL.

If you need a clean build, force one with:

```bash
COSSACK_E2E_REBUILD=1 pnpm --filter @cossackframework/framework test:e2e
```

For faster local iteration, use the development server:

```bash
pnpm --filter @cossackframework/framework test:e2e:dev
```

The development run skips SSG tests because they need production output.

To view the test report after running tests:

```bash
pnpm --filter @cossackframework/framework exec playwright show-report
```

Or directly open:
```bash
open packages/framework/playwright-report/index.html
```

### Test Structure

- `e2e/core-features/`: Tests for framework features (decorators, loading states, navigation, state sync)
- `e2e/pages/`: Tests for individual pages (home, counter, contact, and other pages)

### Test Configuration

The Playwright configuration is located at `packages/framework/playwright.config.ts`. By default, tests run on Chromium only.

### Writing Tests

Tests use Playwright's `test` and `expect` functions from the custom fixtures located in `e2e/fixtures/`.

```typescript
import { test, expect } from '../fixtures';

test.describe('My Feature', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/my-page');
  });

  test('should do something', async ({ page }) => {
    await expect(page.locator('h1')).toBeVisible();
  });
});
```

### Best Practices

1. Wait for readiness: use retrying locator assertions for visible state. Before interacting with SSR markup, wait for the framework readiness signal (`window.__cossackReady`). Avoid fixed sleeps and network-idle waits on streaming pages.
2. Handle multiple elements: use `.first()` when multiple elements match a selector.
3. Timeouts: add explicit timeouts for navigation and async operations.
4. Strict mode: Playwright enforces strict mode. A locator method that matches multiple elements fails.
