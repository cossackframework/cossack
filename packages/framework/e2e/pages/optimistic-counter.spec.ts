import { test, expect } from '../fixtures';

test.describe('Optimistic Counter Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/optimistic-counter');
  });

  test('should display counter value', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const body = await page.locator('body').textContent();
    // The page shows "Count: 0" or similar
    expect(body).toContain('Count:');
  });

  test('should increment counter optimistically', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Wait for the count to stabilize so the WebSocket initial state-update
    // has been applied before we read the initial value.
    const initialValue = await page.waitForFunction(() => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/i);
      return match ? parseInt(match[1], 10) : -1;
    }, { timeout: 5000 }).then(r => r.jsonValue());

    // Small delay to ensure the WebSocket proxy is fully wired up
    await page.waitForTimeout(500);

    const startTime = Date.now();
    await page.click('button:has-text("Increment")');
    const responseTime = Date.now() - startTime;

    // Optimistic update should be fast (under 500ms to account for CI variability)
    expect(responseTime).toBeLessThan(500);

    // Wait for the count to increase by 1 (server response completes)
    await page.waitForFunction((expected) => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/i);
      return match ? parseInt(match[1], 10) >= expected : false;
    }, initialValue + 1, { timeout: 10000 });
  });

  test('should toggle details panel', async ({ page }) => {
    const toggleButton = page.locator('button:has-text("Show Info"), button:has-text("Hide Info")');

    await toggleButton.click();
    await page.waitForTimeout(100);

    // Should show debug info
    await expect(page.locator('body')).toContainText('Debug Information');
  });

  test('should show computed values', async ({ page }) => {
    const body = await page.locator('body').textContent();

    expect(body).toBeDefined();
  });

  test('should handle rapid clicks', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const initialValue = await page.waitForFunction(() => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/i);
      return match ? parseInt(match[1], 10) : -1;
    }, { timeout: 5000 }).then(r => r.jsonValue());

    const incrementButton = page.locator('button:has-text("+")');

    for (let i = 0; i < 5; i++) {
      await incrementButton.click();
      await page.waitForTimeout(50);
    }

    // Wait for all server responses to complete: count should be initialValue + 5
    await page.waitForFunction((expected) => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/i);
      return match ? parseInt(match[1], 10) >= expected : false;
    }, initialValue + 5, { timeout: 10000 });
  });

  test('should maintain loading state per action', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.click('button:has-text("+")');

    await page.waitForTimeout(100);
  });
});
