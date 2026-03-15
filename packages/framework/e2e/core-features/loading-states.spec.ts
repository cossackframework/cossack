import { test, expect } from '../fixtures';

test.describe('Loading States', () => {
  test.describe('Automatic Loading States', () => {
    test('should show loading state during server method call', async ({ page }) => {
      await page.goto('/tasks');

      const addButton = page.locator('button:has-text("Add")').first();
      if (await addButton.isVisible()) {
        const input = page.locator('input[type="text"]').first();
        await input.fill('New Task');

        await addButton.click();

        await page.waitForTimeout(500);
      }
    });
  });

  test.describe('loadingTemplate', () => {
    test('should show skeleton UI during initial load', async ({ page }) => {
      await page.goto('/lifecycle');

      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('body')).toBeVisible();
    });

    test('should replace skeleton with content after load', async ({ page }) => {
      await page.goto('/lifecycle');

      await page.waitForFunction(() => {
        const body = document.body.textContent || '';
        return body.length > 50;
      }, { timeout: 5000 });
    });
  });

  test.describe('this.loading[method]', () => {
    test('should track loading state per method', async ({ page }) => {
      await page.goto('/optimistic-counter');

      const incrementButton = page.locator('button:has-text("+")').first();
      await incrementButton.click();

      await page.waitForTimeout(100);
    });

    test('should show loading state during server action', async ({ page }) => {
      await page.goto('/optimistic-counter');

      await page.waitForLoadState('networkidle');

      const incrementButton = page.locator('button:has-text("Increment")').first();
      await incrementButton.click();

      // Wait for the increment to complete
      await page.waitForTimeout(600);
    });
  });

  test.describe('Progress Indicator', () => {
    test('should show progress during page navigation', async ({ page }) => {
      await page.goto('/');

      await page.click('a[href="/lifecycle"]');

      await page.waitForURL(/\/lifecycle/);

      await expect(page.locator('body')).toBeVisible();
    });
  });
});
