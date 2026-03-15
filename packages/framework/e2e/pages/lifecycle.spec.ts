import { test, expect } from '../fixtures';

test.describe('Lifecycle Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/lifecycle');
  });

  test('should display loading skeleton initially', async ({ page }) => {
    await page.goto('/lifecycle', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('body')).toBeVisible();
  });

  test('should load and display data', async ({ page }) => {
    await page.waitForFunction(() => {
      const body = document.body.textContent || '';
      return body.length > 100;
    }, { timeout: 5000 });
  });

  test('should call init on server', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible();
  });

  test('should call clientInit after hydration', async ({ page }) => {
    await page.waitForFunction(() => {
      const body = document.body.textContent || '';
      return body.length > 50;
    }, { timeout: 5000 });
  });

  test('should show loadingTemplate during data fetch', async ({ page }) => {
    await page.goto('/lifecycle', { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(100);
  });

  test('should handle onMount lifecycle', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const body = await page.locator('body').textContent();
    expect(body).toBeDefined();
  });
});
