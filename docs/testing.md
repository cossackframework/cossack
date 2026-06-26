---
title: "Testing"
description: "Run TypeScript type checking and Playwright end-to-end tests with simple commands for validating framework changes."
---

# Testing

## Running Tests

### Type Checks

Run TypeScript type checking after code changes:

```bash
pnpm tsc --noEmit
```

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

1. **Wait for page loads**: Use `await page.waitForLoadState('networkidle')` before assertions
2. **Handle multiple elements**: Use`.first()` when multiple elements match a selector
3. **Timeouts**: Add explicit timeouts for navigation and async operations
4. **Strict mode**: Playwright enforces strict mode by locator methods return multiple elements
