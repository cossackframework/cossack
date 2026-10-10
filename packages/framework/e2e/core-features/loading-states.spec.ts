import { test, expect } from '@playwright/test';
import { waitForHydration } from '../fixtures/helpers';

// loadingTemplate()/clientInit() coverage lives in e2e/pages/lifecycle.spec.ts.
test.describe('Loading States', () => {
  test('this.loading[method] tracks an in-flight server action', async ({ page }) => {
    await page.goto('/optimistic-counter');
    await waitForHydration(page);
    await page.getByRole('button', { name: 'Show Info', exact: true }).click();
    const loadingCount = page.getByText(/^Loading count: \d+$/);
    await expect(loadingCount).toHaveText('Loading count: 0');

    // increment() sleeps 1s on the server, so the flag is observable.
    await page.getByRole('button', { name: 'Increment (+1)', exact: true }).click();
    await expect(loadingCount).toHaveText('Loading count: 1');
    await expect(loadingCount).toHaveText('Loading count: 0', { timeout: 10_000 });
  });

  test('SPA navigation shows loading.ts and the progress bar until the page arrives', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let intercepted = false;
    await page.route(url => url.pathname === '/lifecycle', async route => {
      intercepted = true;
      await gate;
      await route.continue();
    });

    const sidebar = page.getByTestId('desktop-sidebar');
    const group = sidebar.locator('li[data-sidebar-value="group:Lifecycle & Reactivity"] > details');
    if (await group.getAttribute('open') === null) {
      await group.locator(':scope > summary').click();
    }
    await sidebar.getByRole('link', { name: 'Lifecycle and loading', exact: true }).click();

    // While the page fetch is held, the loading.ts convention UI and the
    // progress bar are displayed.
    await expect.poll(() => intercepted).toBe(true);
    await expect(page.getByRole('heading', { name: 'Loading Page... (Convention)' })).toBeVisible();
    const progress = page.locator('#cossack-progress');
    await expect(progress).toHaveCSS('opacity', '1');
    await expect(progress).toHaveAttribute('style', /width: 30%/);

    release();
    await page.waitForURL(/\/lifecycle$/);
    await expect(page.getByRole('heading', { name: 'Loading Page... (Convention)' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Loading Data\.\.\.|Data Loaded!/ })).toBeVisible();
    await expect(progress).toHaveCSS('opacity', '0');
  });
});
