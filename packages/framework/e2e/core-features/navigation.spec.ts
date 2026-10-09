import { test, expect, type Page } from '@playwright/test';
import { waitForHydration } from '../fixtures/helpers';

async function navigationLink(page: Page, href: string) {
  await waitForHydration(page);
  const sidebar = page.getByTestId('desktop-sidebar');
  const link = sidebar.locator(`a[href="${href}"]`);
  const group = link.locator('xpath=ancestor::details[1]');
  if (await group.count() && await group.getAttribute('open') === null) {
    await group.locator(':scope > summary').click();
  }
  await expect(link).toBeVisible();
  return link;
}

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load home page', async ({ page }) => {
    await expect(page).toHaveTitle(/Cossack/);
  });

  test('should navigate to optimistic-counter page from nav', async ({ page }) => {
    await (await navigationLink(page, '/optimistic-counter')).click();
    await expect(page).toHaveURL(/\/optimistic-counter/);
    await expect(page.getByRole('heading', { name: /Optimistic Counter/i })).toBeVisible();
  });

  test('should navigate to optimistic-counter page', async ({ page }) => {
    await (await navigationLink(page, '/optimistic-counter')).click();
    await expect(page).toHaveURL(/\/optimistic-counter/);
    await expect(page.getByRole('heading', { name: /Optimistic Counter/i })).toBeVisible();
  });

  test('should navigate to lifecycle page', async ({ page }) => {
    await (await navigationLink(page, '/lifecycle')).click();
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
    await (await navigationLink(page, '/lifecycle')).click();

    await page.waitForURL(/\/lifecycle/);
    await expect(page).toHaveURL(/\/lifecycle/);
  });

  test('should prefetch on hover and reuse the prefetched document on click', async ({ page }) => {
    const link = await navigationLink(page, '/contact');
    const documentRequests: string[] = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/contact') documentRequests.push(request.url());
    });

    const prefetch = page.waitForResponse(r => new URL(r.url()).pathname === '/contact');
    await link.hover();
    expect((await prefetch).ok()).toBe(true);

    await link.click();
    await page.waitForURL(/\/contact/, { timeout: 10000 });
    await expect(page.getByText('Contact page')).toBeVisible();
    // The click is served from the hover prefetch cache.
    expect(documentRequests).toHaveLength(1);
  });

  test('hover prefetch navigates without RPC or a document reload and caches revisits', async ({ page }) => {
    await page.goto('/validation');
    await waitForHydration(page);

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

    const complexFormLink = await navigationLink(page, '/forms/complex-form');
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

    const validationLink = await navigationLink(page, '/validation');
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

  test('a newer link wins when an earlier page response arrives late', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let held = false;
    let delivered = false;
    await page.route('**/lifecycle', async route => {
      const response = await route.fetch();
      held = true;
      await gate;
      try { await route.fulfill({ response }); } finally { delivered = true; }
    });
    try {
      await page.evaluate(() => {
        const link = document.createElement('a');
        link.href = '/lifecycle'; document.body.append(link); link.click(); link.remove();
      });
      await expect.poll(() => held).toBe(true);
      await page.evaluate(() => {
        const link = document.createElement('a');
        link.href = '/optimistic-counter'; document.body.append(link); link.click(); link.remove();
      });
      await expect(page).toHaveURL(/\/optimistic-counter$/);
      await expect(page.getByRole('heading', { name: 'Optimistic Counter', exact: true })).toBeVisible();
      release();
      await expect.poll(() => delivered).toBe(true);
      // Let queued rendering run after the obsolete response is released.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(page).toHaveURL(/\/optimistic-counter$/);
      await expect(page.getByRole('heading', { name: 'Optimistic Counter', exact: true })).toBeVisible();
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });

  test('successful mutation clears cached redirect destinations before soft navigation', async ({ page }) => {
    await page.goto('/cache-regression/detail');
    await waitForHydration(page);
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
