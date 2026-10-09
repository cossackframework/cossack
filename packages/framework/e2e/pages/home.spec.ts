import { test, expect } from '@playwright/test';
import { demoCatalog, demoEntries } from '../../src/demo-catalog';
import { waitForHydration } from '../fixtures/helpers';

test.describe('Demo navigation shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);
  });

  test('renders every catalog group and link on the overview', async ({ page }) => {
    await expect(page).toHaveTitle(/Cossack/);
    await expect(page.getByTestId('demo-overview')).toBeVisible();

    for (const group of demoCatalog) {
      await expect(page.locator(`[data-demo-category="${group.category}"]`)).toBeVisible();
    }

    for (const entry of demoEntries) {
      await expect(page.locator(`[data-demo-url="${entry.url}"]`)).toHaveCount(1);
    }
  });

  test('filters navigation by page and category and announces an empty state', async ({ page }) => {
    const search = page.getByRole('searchbox', { name: 'Filter demos' });

    await search.fill('optimistic');
    await expect(page.locator('#demo-desktop-navigation summary').filter({ has: page.getByText('State & Data Flow', { exact: true }) })).toBeVisible();
    await expect(page.locator('#demo-desktop-navigation summary').filter({ has: page.getByText('Authentication', { exact: true }) })).toHaveCount(0);

    await search.fill('authentication');
    await expect(page.locator('#demo-desktop-navigation summary').filter({ has: page.getByText('Authentication', { exact: true }) })).toBeVisible();
    await expect(page.locator('#demo-desktop-navigation summary').filter({ has: page.getByText('State & Data Flow', { exact: true }) })).toHaveCount(0);

    await search.fill('definitely not a demo');
    await expect(page.getByRole('status')).toContainText('No demos match');
  });

  test('opens the command palette and navigates with the keyboard', async ({ page }) => {
    await page.keyboard.press('Control+K');
    const commandSearch = page.getByPlaceholder('Go to a demo…');
    await expect(commandSearch).toBeVisible();
    await commandSearch.fill('Contact and flash messages');
    await commandSearch.press('Enter');
    await expect(page).toHaveURL(/\/contact$/);
    await expect(commandSearch).not.toBeVisible();
  });

  test('uses SPA links and follows active navigation state', async ({ page }) => {
    const overviewTrigger = page.locator('#demo-desktop-navigation summary').filter({ has: page.getByText('Overview', { exact: true }) });
    await expect(overviewTrigger).toBeVisible();
    await expect(overviewTrigger).toHaveAccessibleName('Overview');
    await page.locator('.cs-sidebar__link[href="/contact"]').first().click();

    await expect(page).toHaveURL(/\/contact$/);
    await expect(page.locator('.cs-sidebar__link[href="/contact"]').first()).toHaveClass(/font-medium/);
    await expect(page.locator('.contact-layout')).toBeVisible();
  });

  test('desktop collapse and mobile navigation are keyboard accessible', async ({ page }) => {
    const collapse = page.getByRole('button', { name: 'Collapse navigation' }).first();
    await collapse.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Expand navigation' }).first()).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileTrigger = page.getByRole('button', { name: 'Open navigation' });
    await mobileTrigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Demo navigation' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Demo navigation' })).not.toBeVisible();
  });
});

for (const route of ['/', '/config-demo']) {
  test(`hydrates the server-rendered App shell at ${route} without replacing it`, async ({ page }) => {
    await page.addInitScript(() => {
      const observer = new MutationObserver(() => {
        const shell = document.getElementById('app-wrapper');
        if (shell) {
          (window as any).__ssrAppShell = shell;
          observer.disconnect();
        }
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    const response = await page.goto(route);
    // Production HTML is minified, so attribute quotes may be dropped.
    expect(await response!.text()).toMatch(/id="?app-wrapper\b/);
    await waitForHydration(page);
    expect(await page.evaluate(() => (window as any).__ssrAppShell === document.getElementById('app-wrapper'))).toBe(true);
  });
}
