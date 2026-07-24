import { test, expect } from '../fixtures';
import { demoCatalog, demoEntries } from '../../src/demo-catalog';

test.describe('Demo navigation shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => (window as any).__cossackReady === true,
      undefined,
      { timeout: 15000 },
    );
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
    await expect(page.getByRole('button', { name: 'State & Data Flow' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Authentication' })).toHaveCount(0);

    await search.fill('authentication');
    await expect(page.getByRole('button', { name: 'Authentication' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'State & Data Flow' })).toHaveCount(0);

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
    await expect(commandSearch).toHaveCount(0);
  });

  test('uses SPA links and follows active navigation state', async ({ page }) => {
    const overviewTrigger = page.getByRole('button', { name: 'Overview' }).first();
    await expect(overviewTrigger).toBeVisible();
    await page.locator('.cs-sidebar__sublink[href="/contact"]').first().click();

    await expect(page).toHaveURL(/\/contact$/);
    await expect(page.locator('.cs-sidebar__sublink[href="/contact"]').first()).toHaveClass(/font-medium/);
    await expect(page.locator('.contact-layout')).toBeVisible();
  });

  test('desktop collapse and mobile navigation are keyboard accessible', async ({ page }) => {
    const collapse = page.getByRole('button', { name: 'Collapse sidebar' }).first();
    await collapse.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Expand sidebar' }).first()).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileTrigger = page.getByRole('button', { name: 'Open navigation' });
    await mobileTrigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Demo navigation' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Demo navigation' })).not.toBeVisible();
  });
});
