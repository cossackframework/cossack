import { test, expect } from '@playwright/test';

test.describe('Contact Page', () => {
  test('should display contact form with the default greeting', async ({ page }) => {
    await page.goto('/contact');
    await expect(page).toHaveTitle(/Contact/);
    await expect(page.getByText('Hello Tan', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Name')).toHaveValue('Tan');
    await expect(page.locator('form[method="post"][action="/contact"]')).toBeVisible();
  });

  test('should submit form via POST and follow the redirect', async ({ page }) => {
    await page.goto('/contact');
    await page.getByLabel('Name').fill('Test User');
    const post = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/contact');
    await page.getByRole('button', { name: 'Submit' }).click();
    expect((await post).status()).toBe(302);

    await page.waitForURL(/\/contact\?name=Test%20User$/);
    await expect(page.getByText('Hello Test User', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Name')).toHaveValue('Test User');
  });

  test('should initialize state from query parameters in init()', async ({ page }) => {
    await page.goto('/contact?name=QueryName');
    await expect(page.getByText('Hello QueryName', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Name')).toHaveValue('QueryName');
  });

  test('should fall back to the default greeting for an empty submission', async ({ page }) => {
    await page.goto('/contact?name=Someone');
    await page.getByLabel('Name').fill('');
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.waitForURL(/\/contact\?name=Tan$/);
    await expect(page.getByText('Hello Tan', { exact: true })).toBeVisible();
  });
});
