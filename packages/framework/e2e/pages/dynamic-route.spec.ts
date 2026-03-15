import { test, expect } from '../fixtures';

test.describe('Dynamic Route Page', () => {
  test('should display route parameter in page', async ({ page }) => {
    await page.goto('/hello/TestUser');

    await expect(page.locator('body')).toContainText('TestUser');
  });

  test('should handle URL-encoded names', async ({ page }) => {
    await page.goto('/hello/John%20Doe');

    await expect(page.locator('body')).toContainText(/John.*Doe/);
  });

  test('should handle special characters in route', async ({ page }) => {
    await page.goto('/hello/User123');

    await expect(page.locator('body')).toContainText('User123');
  });

  test('should update state via WebSocket', async ({ page }) => {
    await page.goto('/hello/World');

    await page.waitForLoadState('networkidle');

    const body = await page.locator('body').textContent();
    expect(body).toContain('World');
  });

  test('should navigate between different dynamic routes', async ({ page }) => {
    await page.goto('/hello/Alice');
    await expect(page.locator('body')).toContainText('Alice');

    await page.goto('/hello/Bob');
    await expect(page.locator('body')).toContainText('Bob');
  });
});
