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

The framework's SSG output checks require `pnpm --filter
@cossackframework/framework build:ssg` first. Without those artifacts, the six
output checks are skipped. CI runs the SSG browser and artifact checks in a
separate step. SSG browser tests use the separate
`pnpm --filter @cossackframework/framework test:e2e:ssg` command.

### Live Database Tests (Before a Release)

PostgreSQL and MySQL tests run only on your machine, not in CI. Run them
before every release:

```bash
pnpm test:databases
```

Prerequisites:

- Docker, or two disposable databases: set both `COSSACK_TEST_POSTGRES_URL`
  and `COSSACK_TEST_MYSQL_URL`. The tests drop and create their own `live_*`,
  `rt15_*`, `sl_*` and `se_*` objects, and create a temporary role on PostgreSQL.
- Installed dependencies (`pnpm install`) and Playwright's Chromium
  (`pnpm --filter @cossackframework/studio exec playwright install chromium`).

The command does the following:

1. If both URLs are set, it uses them. Otherwise it starts the pinned
   `postgres:18.6` and `mysql:8.0.46` images with Docker on free loopback ports.
   The MySQL server runs in UTC+7 (`TZ=Asia/Bangkok`). The command waits until
   both servers accept connections, and it always removes the containers and
   their volumes at the end, also after a failure or Ctrl+C.
2. It builds the workspace (`pnpm build`). Pass `--no-build` to skip this when
   the packages are already built: `pnpm test:databases --no-build`.
3. It sets `COSSACK_TEST_REQUIRE_LIVE=1`, so a missing URL fails a test file
   instead of skipping it. Then it runs:
   - the database tests (`pnpm --filter @cossackframework/database run test`),
     including `test/live-dialects.test.ts` on SQLite, Turso, D1, PostgreSQL,
     MySQL and the Hyperdrive drivers;
   - the Studio live introspection tests
     (`packages/studio/tests/live-introspection.test.ts`);
   - the Studio MySQL browser test (`packages/studio/e2e/mysql-definition.spec.ts`).

It runs all three suites, prints a summary and exits non-zero if any suite
fails. Without Docker and without both URLs, it stops with an error that says
so.

What the live tests check:

- The MySQL adapter must store and read UTC values on a UTC+7 server. The
  Hyperdrive MySQL target cannot set the session time zone, so it skips its
  `DEFAULT CURRENT_TIMESTAMP` test on that server (see
  `packages/database/docs/models.md`).
- Studio loads a schema with a fixed number of queries, and its result must
  match the pinned JSON files in `packages/studio/tests/__snapshots__/`. On
  PostgreSQL, a temporary login role with only `SELECT` rights must see the same
  keys and foreign keys as the owner. That test skips when the user cannot
  create roles.
- The Studio Structure tab loads MySQL definitions on demand.

To run one suite against your own servers, set the URLs and run its command
directly. Without the URLs, the PostgreSQL and MySQL tests skip:

```bash
COSSACK_TEST_POSTGRES_URL=postgres://cossack:cossack@127.0.0.1:5432/cossack_test \
COSSACK_TEST_MYSQL_URL=mysql://root:cossack@127.0.0.1:3306/cossack_test \
pnpm --filter @cossackframework/database run test --watch=false
```

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
