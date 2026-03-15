import { test, expect } from '../fixtures';

test.describe('Counter HTTP Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/counter-http');
  });

  test('should display counter value', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const body = await page.locator('body').textContent();
    // The counter page shows "Count: 0" initially
    expect(body).toContain('Count:');
  });

  test('should increment counter via HTTP', async ({ page }) => {
    const body = await page.locator('body').textContent();
    const initialMatch = body?.match(/Count:\s*(\d+)/);
    const initialValue = initialMatch ? parseInt(initialMatch[1], 10) : 0;

    await page.click('button:has-text("+")');

    await page.waitForFunction((expected) => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/);
      return match ? parseInt(match[1], 10) === expected : false;
    }, initialValue + 1);
  });

  test('should decrement counter and redirect to tasks', async ({ page }) => {
    // Note: The decrement button redirects to /tasks
    await page.click('button:has-text("-")');

    // Wait for redirect to tasks page
    await page.waitForURL(/\/tasks/, { timeout: 10000 });
    await expect(page).toHaveURL(/\/tasks/);
  });

  test('should handle redirect on decrement', async ({ page }) => {
    const decrementButton = page.locator('button:has-text("-")');

    await decrementButton.click();

    await page.waitForTimeout(500);
  });

  test('should reset state on page reload (HTTP transport)', async ({ page }) => {
    // Note: HTTP transport does not persist state across reloads
    // Each reload resets the counter to initial value (0)
    const body = await page.locator('body').textContent();
    const initialMatch = body?.match(/Count:\s*(\d+)/);
    const initialValue = initialMatch ? parseInt(initialMatch[1], 10) : 0;

    await page.click('button:has-text("+")');

    await page.waitForFunction((expected) => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/);
      return match ? parseInt(match[1], 10) === expected : false;
    }, initialValue + 1);

    await page.reload();

    // After reload, counter resets to initial value (0) since HTTP transport doesn't persist
    const afterReloadBody = await page.locator('body').textContent();
    const afterReloadMatch = afterReloadBody?.match(/Count:\s*(\d+)/);
    const afterReloadValue = afterReloadMatch ? parseInt(afterReloadMatch[1], 10) : 0;

    // State resets to 0 on reload with HTTP transport
    expect(afterReloadValue).toBe(0);
  });
});
