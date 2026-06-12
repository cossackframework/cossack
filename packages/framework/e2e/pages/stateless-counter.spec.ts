import { test, expect } from '../fixtures';

test.describe('Stateless Counter Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/stateless-counter');
  });

  test('should display counter with default value 0', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const body = await page.locator('body').textContent();
    expect(body).toContain('Count: 0');
  });

  test('should increment counter via WebSocket', async ({ page }) => {
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

    await page.click('button:has-text("Increment")');

    // Wait for the count to increase by 1
    await page.waitForFunction((expected) => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/i);
      return match ? parseInt(match[1], 10) >= expected : false;
    }, initialValue + 1, { timeout: 10000 });
  });

  test('should handle rapid clicks', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const initialValue = await page.waitForFunction(() => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/i);
      return match ? parseInt(match[1], 10) : -1;
    }, { timeout: 5000 }).then(r => r.jsonValue());

    const incrementButton = page.locator('button:has-text("Increment")');

    for (let i = 0; i < 3; i++) {
      await incrementButton.click();
      await page.waitForTimeout(50);
    }

    // Wait for all server responses to complete
    await page.waitForFunction((expected) => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/i);
      return match ? parseInt(match[1], 10) >= expected : false;
    }, initialValue + 3, { timeout: 10000 });
  });

  test('should render stateless description text', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const body = await page.locator('body').textContent();
    expect(body).toContain('Stateless Counter');
    expect(body).toContain('stateless');
  });
});
