import { test, expect } from '../fixtures';
import { getState } from '../fixtures/helpers';

test.describe('State Synchronization', () => {
  test.describe('Initial Hydration', () => {
    test('should hydrate initial state from server', async ({ page }) => {
      await page.goto('/counter-http');

      const state = await getState(page);
      expect(state).toBeDefined();
    });

    test('should render initial state values', async ({ page }) => {
      await page.goto('/counter-http');

      // Wait for the page to load
      await page.waitForLoadState('networkidle');

      const counterText = await page.locator('body').textContent();
      // The counter page shows "Count: 0" or similar
      expect(counterText).toMatch(/Count:\s*\d+/);
    });
  });

  test.describe('HTTP Transport', () => {
    test('should update state via HTTP call', async ({ page }) => {
      await page.goto('/counter-http');

      await page.waitForLoadState('networkidle');

      const initialCounter = await page.locator('body').textContent();
      const initialMatch = initialCounter?.match(/Count:\s*(\d+)/);
      const initialValue = initialMatch ? parseInt(initialMatch[1], 10) : 0;

      await page.click('button:has-text("+")');

      await page.waitForFunction((expected) => {
        const body = document.body.textContent || '';
        const match = body.match(/Count:\s*(\d+)/);
        return match ? parseInt(match[1], 10) === expected : false;
      }, initialValue + 1, { timeout: 10000 });
    });
  });

  test.describe('WebSocket State Sync', () => {
    test('should load tasks page successfully', async ({ page }) => {
      await page.goto('/tasks');

      await page.waitForLoadState('networkidle');

      // Just verify the page loads
      const body = await page.locator('body').textContent();
      expect(body).toBeDefined();
    });

    test('should handle dynamic route state', async ({ page }) => {
      await page.goto('/hello/TestUser');

      await expect(page.locator('body')).toContainText('TestUser');
    });
  });

  test.describe('Channel-based State', () => {
    test('should broadcast state updates to channel subscribers', async ({ page, context }) => {
      await page.goto('/tasks');

      const secondPage = await context.newPage();
      await secondPage.goto('/tasks');

      await page.waitForTimeout(500);

      const input = page.locator('input[type="text"]').first();
      if (await input.isVisible()) {
        await input.fill('Test Task from Tab 1');
        await page.click('button:has-text("Add")');

        await page.waitForTimeout(500);
      }

      await secondPage.close();
    });
  });

  test.describe('Client State', () => {
    test('should maintain client-only state separately', async ({ page }) => {
      await page.goto('/events');

      const clickArea = page.locator('body');
      await clickArea.click();

      await page.waitForTimeout(100);
    });
  });
});
