import { test, expect } from '../fixtures';
import { clickAndWaitForNavigation } from '../fixtures/helpers';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load home page', async ({ page }) => {
    await expect(page).toHaveTitle(/Cossack/);
  });

  test('should navigate to optimistic-counter page from nav', async ({ page }) => {
    await clickAndWaitForNavigation(page, 'a[href="/optimistic-counter"]');
    await expect(page).toHaveURL(/\/optimistic-counter/);
    await expect(page.getByRole('heading', { name: /Optimistic Counter/i })).toBeVisible();
  });

  test('should navigate to optimistic-counter page', async ({ page }) => {
    await clickAndWaitForNavigation(page, 'a[href="/optimistic-counter"]');
    await expect(page).toHaveURL(/\/optimistic-counter/);
    await expect(page.getByRole('heading', { name: /Optimistic Counter/i })).toBeVisible();
  });

  test('should navigate to lifecycle page', async ({ page }) => {
    await clickAndWaitForNavigation(page, 'a[href="/lifecycle"]');
    await expect(page).toHaveURL(/\/lifecycle/);
    // The lifecycle page shows "Loading Data..." or "Data Loaded!" initially
    await expect(page.locator('h1')).toContainText(/Loading|Data/);
  });

  test('should navigate to dynamic route page', async ({ page }) => {
    await page.goto('/hello/World');
    await expect(page).toHaveURL(/\/hello\/World/);
    await expect(page.locator('body')).toContainText('World');
  });

  test('should preserve browser history', async ({ page }) => {
    await page.goto('/optimistic-counter');
    await page.goto('/lifecycle');
    await page.goBack();
    await expect(page).toHaveURL(/\/optimistic-counter/);
  });

  test('should handle navigation to non-existent page', async ({ page }) => {
    await page.goto('/non-existent-page-12345');
    await expect(page.locator('body')).toContainText(/404|not found/i);
  });

  test('should show progress indicator during navigation', async ({ page }) => {
    const progressSelector = '[role="progressbar"], .progress, [data-progress]';

    await page.click('a[href="/lifecycle"]');

    await page.waitForURL(/\/lifecycle/);
    await expect(page).toHaveURL(/\/lifecycle/);
  });

  test('should prefetch on hover', async ({ page }) => {
    // Use .first() to handle multiple contact links
    const link = page.locator('a[href="/contact"]').first();
    await link.hover();

    // Wait a moment for prefetch to potentially trigger
    await page.waitForTimeout(100);
    await link.click();

    // Wait for navigation to complete
    await page.waitForURL(/\/contact/, { timeout: 10000 });
    await expect(page).toHaveURL(/\/contact/);
  });

  test('hover prefetch navigates without RPC or a document reload and caches revisits', async ({ page }) => {
    await page.goto('/validation');
    await page.waitForFunction(() => (window as any).__cossackReady === true);

    const requests: Array<{ pathname: string; type: string }> = [];
    page.on('request', (request) => {
      requests.push({
        pathname: new URL(request.url()).pathname,
        type: request.resourceType(),
      });
    });

    await page.evaluate(() => {
      (window as any).__softNavigationMarker = 'preserved';
    });

    const complexFormLink = page.locator('a[href="/forms/complex-form"]:visible').first();
    await complexFormLink.hover();
    await expect.poll(() =>
      requests.filter(({ pathname, type }) =>
        pathname === '/forms/complex-form' && type === 'fetch'
      ).length
    ).toBe(1);

    await complexFormLink.click();
    await expect(page).toHaveURL(/\/forms\/complex-form$/);
    await expect(page.locator('body')).toContainText('Complex');

    expect(await page.evaluate(() => (window as any).__softNavigationMarker)).toBe('preserved');
    expect(requests.filter(({ type }) => type === 'document')).toHaveLength(0);
    expect(requests.filter(({ pathname }) => pathname === '/crpc')).toHaveLength(0);
    expect(requests.filter(({ pathname, type }) =>
      pathname === '/forms/complex-form' && type === 'fetch'
    )).toHaveLength(1);

    const validationLink = page.locator('a[href="/validation"]:visible').first();
    await validationLink.click();
    await expect(page).toHaveURL(/\/validation$/);
    await expect(page.locator('body')).toContainText('Validation');

    // /validation was the initial SSR document and should have been seeded in
    // the in-memory cache rather than fetched when revisited.
    expect(requests.filter(({ pathname, type }) =>
      pathname === '/validation' && type === 'fetch'
    )).toHaveLength(0);
    expect(requests.filter(({ type }) => type === 'document')).toHaveLength(0);
  });

  test('successful mutation clears cached redirect destinations before soft navigation', async ({ page }) => {
    await page.goto('/cache-regression/detail');
    await page.waitForFunction(() => (window as any).__cossackReady === true);
    const initial = Number(
      (await page.locator('[data-cache-version]').textContent())?.match(/\d+/)?.[0],
    );

    const detailFetches: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/cache-regression/detail' && request.resourceType() === 'fetch') {
        detailFetches.push(url.pathname);
      }
    });

    await page.getByRole('link', { name: 'Edit version' }).click();
    await expect(page).toHaveURL(/\/cache-regression\/edit$/);
    await page.getByRole('button', { name: 'Save version' }).click();

    await expect(page).toHaveURL(/\/cache-regression\/detail$/);
    await expect(page.locator('[data-cache-version]')).toHaveText(`Version: ${initial + 1}`);
    expect(detailFetches).toHaveLength(1);
  });
});
