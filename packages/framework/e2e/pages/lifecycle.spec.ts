import { test, expect } from '@playwright/test';
import { waitForHydration } from '../fixtures/helpers';

const ITEMS = ['Cossack', 'Hono', 'Cloudflare', 'Durable Objects'];

test.describe('Lifecycle Page', () => {
  test('SSR skips init() and responds with the loadingTemplate', async ({ request }) => {
    const response = await request.get('/lifecycle');
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain('Loading Data...');
    expect(html).not.toContain('Data Loaded!');
  });

  test('clientInit() fetches data via RPC after hydration', async ({ page }) => {
    await page.goto('/lifecycle');
    await waitForHydration(page);

    // init() sleeps 2s on the server before resolving.
    await expect(page.getByRole('heading', { name: 'Data Loaded!' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Loading Data...' })).toHaveCount(0);
    for (const item of ITEMS) {
      await expect(page.getByRole('listitem').filter({ hasText: new RegExp(`^${item}$`) })).toBeVisible();
    }
  });

  test('re-running init() shows the loadingTemplate again, then the data', async ({ page }) => {
    await page.goto('/lifecycle');
    await waitForHydration(page);
    const refresh = page.getByRole('button', { name: /Refresh Data/ });
    await expect(refresh).toBeVisible({ timeout: 10_000 });

    await refresh.click();
    await expect(page.getByRole('heading', { name: 'Loading Data...' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Data Loaded!' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('listitem').filter({ hasText: /^Durable Objects$/ })).toBeVisible();
  });
});
