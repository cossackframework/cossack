---
title: "Testing"
description: "Run TypeScript type checking and Playwright end-to-end tests with simple commands for validating framework changes."
---

# Testing

## Running Tests

### Type Checks

For this monorepo, build package dependencies first, then check every TypeScript
package explicitly. Root `tsc --noEmit` alone does not traverse project references:

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
`test-utils` package has no tests yet and is excluded. For watch mode or a
focused test, use `pnpm --filter <package-name> exec vitest <test-file>`.

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

to view the test report after running tests:

```bash
pnpm --filter @cossackframework/framework exec playwright show-report
```

Or directly open:
```bash
open packages/framework/playwright-report/index.html
```

### Test Structure

- **e2e/core-features/**: Tests for framework features (decorators, loading states, navigation, state sync)
- **e2e/pages/**: Tests for individual pages (home, counter, contact, etc.)

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

1. **Wait for readiness**: Use retrying locator assertions for visible state. Before interacting with SSR markup, wait for the framework readiness signal (`window.__cossackReady`). Avoid fixed sleeps and network-idle waits on streaming pages.
2. **Handle multiple elements**: Use`.first()` when multiple elements match a selector
3. **Timeouts**: Add explicit timeouts for navigation and async operations
4. **Strict mode**: Playwright enforces strict mode by locator methods return multiple elements
