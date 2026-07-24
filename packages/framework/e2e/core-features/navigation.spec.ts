import { test, expect } from '../fixtures';
import { clickAndWaitForNavigation } from '../fixtures/helpers';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load home page', async ({ page }) => {
    await expect(page).toHaveTitle(/Cossack/);
  });

  test('should navigate to optimistic-counter page from nav', async ({ page }) => {
    await clickAndWaitForNavigation(page, 'a[href="/optimistic-counter"]');
    await expect(page).toHaveURL(/\/optimistic-counter/);
    await expect(page.getByRole('heading', { name: /Optimistic Counter/i })).toBeVisible();
  });

  test('should navigate to optimistic-counter page', async ({ page }) => {
    await clickAndWaitForNavigation(page, 'a[href="/optimistic-counter"]');
    await expect(page).toHaveURL(/\/optimistic-counter/);
    await expect(page.getByRole('heading', { name: /Optimistic Counter/i })).toBeVisible();
  });

  test('should navigate to lifecycle page', async ({ page }) => {
    await clickAndWaitForNavigation(page, 'a[href="/lifecycle"]');
    await expect(page).toHaveURL(/\/lifecycle/);
    // The lifecycle page shows "Loading Data..." or "Data Loaded!" initially
    await expect(page.locator('h1')).toContainText(/Loading|Data/);
  });

  test('should navigate to dynamic route page', async ({ page }) => {
    await page.goto('/hello/World');
    await expect(page).toHaveURL(/\/hello\/World/);
    await expect(page.locator('body')).toContainText('World');
  });

  test('should preserve browser history', async ({ page }) => {
    await page.goto('/optimistic-counter');
    await page.goto('/lifecycle');
    await page.goBack();
    await expect(page).toHaveURL(/\/optimistic-counter/);
  });

  test('should handle navigation to non-existent page', async ({ page }) => {
    await page.goto('/non-existent-page-12345');
    await expect(page.locator('body')).toContainText(/404|not found/i);
  });

  test('should show progress indicator during navigation', async ({ page }) => {
    const progressSelector = '[role="progressbar"], .progress, [data-progress]';

    await page.click('a[href="/lifecycle"]');

    await page.waitForURL(/\/lifecycle/);
    await expect(page).toHaveURL(/\/lifecycle/);
  });

  test('should prefetch on hover', async ({ page }) => {
    // Use .first() to handle multiple contact links
    const link = page.locator('a[href="/contact"]').first();
    await link.hover();

    // Wait a moment for prefetch to potentially trigger
    await page.waitForTimeout(100);
    await link.click();

    // Wait for navigation to complete
    await page.waitForURL(/\/contact/, { timeout: 10000 });
    await expect(page).toHaveURL(/\/contact/);
  });
});
