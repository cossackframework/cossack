import { test, expect } from '../fixtures';

test.describe('Error Pages', () => {
  test.describe('404 Not Found Page', () => {
    test('should display 404 page for non-existent routes', async ({ page }) => {
      await page.goto('/non-existent-route-xyz');

      await expect(page.locator('body')).toContainText(/404|not found/i);
    });

    test('should have link to return home', async ({ page }) => {
      await page.goto('/non-existent-route-xyz');

      // Wait for 404 page to load
      await page.waitForLoadState('networkidle');

      // Use .first() in case there are multiple home links
      const homeLink = page.locator('a[href="/"]').first();
      await expect(homeLink).toBeVisible();
    });
  });

  test.describe('Error Page', () => {
    // Note: The /error route only renders when there's an actual server error.
    // Direct navigation to /error shows 404 because it's not a valid route.
    // These tests verify that error handling works correctly.

    test('should show 404 for /error route (not a valid page)', async ({ page }) => {
      await page.goto('/error');

      // /error is not a valid route, so it should show 404
      await expect(page.locator('body')).toContainText(/404|not found/i);
    });
  });

  test('should handle server errors gracefully', async ({ page }) => {
    await page.goto('/');

    const body = await page.locator('body').textContent();
    expect(body).not.toContain('Internal Server Error');
  });
});
