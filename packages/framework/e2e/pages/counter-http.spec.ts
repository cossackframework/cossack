import { test, expect } from '@playwright/test';
import { waitForHydration } from '../fixtures/helpers';

test.describe('Counter HTTP Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/counter-http');
    await waitForHydration(page);
  });

  test('should display the server-initialized counter value', async ({ page }) => {
    await expect(page).toHaveTitle(/Counter \(HTTP\)/);
    await expect(page.getByText(/^Count: -?\d+$/)).toHaveText('Count: 0');
  });

  test('should increment counter via an HTTP server call', async ({ page }) => {
    const rpc = page.waitForResponse(r => r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Increment', exact: true }).click();
    expect((await rpc).ok()).toBe(true);
    await expect(page.getByText(/^Count: -?\d+$/)).toHaveText('Count: 1');
  });

  test('should decrement counter and follow the server redirect to tasks', async ({ page }) => {
    await page.getByRole('button', { name: 'Decrement', exact: true }).click();
    await page.waitForURL(/\/tasks$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  });

  test('should reset state on page reload (HTTP transport)', async ({ page }) => {
    const count = page.getByText(/^Count: -?\d+$/);
    await page.getByRole('button', { name: 'Increment', exact: true }).click();
    await expect(count).toHaveText('Count: 1');

    await page.reload();
    // HTTP transport does not persist state: init() runs again per request.
    await expect(count).toHaveText('Count: 0');
  });
});
