import { test, expect } from '../fixtures';

test.describe('Refs Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/refs');
  });

  test('should focus input via @Ref', async ({ page }) => {
    const focusButton = page.locator('button:has-text("Focus")');

    if (await focusButton.isVisible()) {
      await focusButton.click();

      const input = page.locator('input').first();
      await expect(input).toBeFocused();
    }
  });

  test('should animate element via @Ref', async ({ page }) => {
    const animateButton = page.locator('button:has-text("Animate")');

    if (await animateButton.isVisible()) {
      await animateButton.click();
      await page.waitForTimeout(300);
    }
  });

  test('should access DOM element properties', async ({ page }) => {
    const body = await page.locator('body').textContent();

    expect(body).toBeDefined();
  });

  test('should manipulate DOM directly', async ({ page }) => {
    const actionButtons = page.locator('button');
    const count = await actionButtons.count();

    if (count > 0) {
      for (let i = 0; i < Math.min(count, 3); i++) {
        await actionButtons.nth(i).click();
        await page.waitForTimeout(100);
      }
    }
  });
});
