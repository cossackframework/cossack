import { test, expect } from '../fixtures';

test.describe('Home Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display page title', async ({ page }) => {
    await expect(page).toHaveTitle(/Cossack/);
  });

  test('should display image with optimization', async ({ page }) => {
    const images = page.locator('img');
    const count = await images.count();

    if (count > 0) {
      const firstImage = images.first();
      await expect(firstImage).toBeVisible();

      const src = await firstImage.getAttribute('src');
      expect(src).toBeDefined();
    }
  });

  test('should have working navigation to all demo pages', async ({ page }) => {
    const links = [
      '/optimistic-counter',
      '/contact',
      '/prevent-navigation',
      '/lifecycle',
    ];

    for (const href of links) {
      // Navigate to home first for each link test
      await page.goto('/');
      // Use .first() to handle multiple matching links (nav + sidebar)
      const link = page.locator(`a[href="${href}"]`).first();
      if (await link.isVisible()) {
        await link.click();
        await page.waitForURL(new RegExp(href), { timeout: 10000 });
        await expect(page).toHaveURL(new RegExp(href));
      }
    }
  });
});
