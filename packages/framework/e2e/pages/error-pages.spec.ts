import { test, expect } from '@playwright/test';
import { waitForHydration } from '../fixtures/helpers';

test.describe('Error Pages', () => {
  test.describe('404 Not Found Page', () => {
    test('should display 404 page for non-existent routes', async ({ page }) => {
      const response = await page.goto('/non-existent-route-xyz');

      expect(response?.status()).toBe(404);
      await expect(page.locator('body')).toContainText(/404|not found/i);
    });

    test('should have link to return home', async ({ page }) => {
      await page.goto('/non-existent-route-xyz');

      // Wait for 404 page to load
      await waitForHydration(page);

      // Use .first() in case there are multiple home links
      const homeLink = page.locator('a[href="/"]').first();
      await expect(homeLink).toBeVisible();
    });
  });

  test.describe('What the page is told', () => {
    test('shows the request id of its response, before and after hydration', async ({ page }) => {
      const response = await page.goto('/non-existent-route-xyz');
      const id = response?.headers()['x-cossack-request-id'];
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      await expect(page.locator('[data-reference]')).toHaveText(id!);
      await waitForHydration(page);
      await expect(page.locator('[data-reference]')).toHaveText(id!);
    });

    test('shows the id of the fetched page after a navigation in the browser', async ({ page }) => {
      await page.goto('/');
      await waitForHydration(page);
      const answered = page.waitForResponse(response => new URL(response.url()).pathname === '/another-missing-page-xyz');
      await page.evaluate(() => {
        const link = document.createElement('a');
        link.href = '/another-missing-page-xyz';
        link.textContent = 'missing';
        link.id = 'missing-link';
        // Above the layout, so nothing takes the click.
        link.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647';
        document.body.append(link);
      });
      await page.click('#missing-link');
      const id = (await answered).headers()['x-cossack-request-id'];
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      await expect(page.locator('[data-reference]')).toHaveText(id);
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
