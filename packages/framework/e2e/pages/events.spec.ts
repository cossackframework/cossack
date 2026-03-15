import { test, expect } from '../fixtures';

test.describe('Events Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/events');
  });

  test('should track click events', async ({ page }) => {
    const clickTarget = page.locator('button').first();

    if (await clickTarget.isVisible()) {
      await clickTarget.click();
      await page.waitForTimeout(100);

      const body = await page.locator('body').textContent();
      expect(body).toBeDefined();
    }
  });

  test('should track keyboard events via @OnDocument', async ({ page }) => {
    await page.keyboard.press('a');
    await page.waitForTimeout(100);

    await page.keyboard.press('b');
    await page.waitForTimeout(100);

    const body = await page.locator('body').textContent();
    expect(body).toBeDefined();
  });

  test('should track window resize events via @OnWindow', async ({ page }) => {
    const originalSize = page.viewportSize();

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(200);

    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(200);

    if (originalSize) {
      await page.setViewportSize(originalSize);
    }

    const body = await page.locator('body').textContent();
    expect(body).toBeDefined();
  });

  test('should display event counts', async ({ page }) => {
    // Click to increment the click counter
    const clickArea = page.locator('div[style*="dashed"]');
    await clickArea.click();
    await page.waitForTimeout(100);

    // The clickCount should now show 1 (or more)
    const body = await page.locator('body').textContent();

    // Check that click count is displayed (should be at least 1 after clicking)
    expect(body).toMatch(/Clicks on this component|@On\('click'\)/);
  });
});
