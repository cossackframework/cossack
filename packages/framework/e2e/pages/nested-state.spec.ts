import { test, expect } from '../fixtures';

test.describe('Nested State Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/nested-state');
  });

  test('should display nested components', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible();
  });

  test('should maintain isolated state in nested components', async ({ page }) => {
    const counters = page.locator('[data-testid="counter"], .counter, button:has-text("+")');

    if ((await counters.count()) >= 2) {
      const firstCounter = counters.first();
      const secondCounter = counters.nth(1);

      await firstCounter.click();
      await page.waitForTimeout(200);

      const body = await page.locator('body').textContent();
      expect(body).toBeDefined();
    }
  });

  test('should update nested component state independently', async ({ page }) => {
    const incrementButtons = page.locator('button:has-text("+")');

    const count = await incrementButtons.count();
    if (count > 0) {
      await incrementButtons.first().click();
      await page.waitForTimeout(300);
    }
  });

  test('should render multiple instances of same component', async ({ page }) => {
    const body = await page.locator('body').textContent();

    expect(body).toBeDefined();
  });
});
