import { expect, test } from '@playwright/test';
import { waitForHydration } from '../fixtures/helpers';

test.describe('Renderer component tags demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/renderer/component-tags');
    await expect(page.locator('[data-component-tags-demo]')).toBeVisible();
    await waitForHydration(page);
  });

  test('updates tag props and children in place', async ({ page }) => {
    const live = page.locator('#tile-live');
    await live.evaluate((element) => ((window as any).__cossackLiveTile = element));

    await page.locator('#tags-click').click();
    await expect(live.locator('[data-heading]')).toHaveText('Clicked 1 times');
    await expect(live.locator('[data-count]')).toHaveText('1');
    await expect(page.locator('#frame-value [data-frame-content]')).toHaveText('1');
    await expect(page.locator('#frame-template [data-frame-content]')).toHaveText('Markup with 1 clicks');
    expect(await live.evaluate((element) => element === (window as any).__cossackLiveTile)).toBe(true);
  });

  test('keeps child state across parent renders and reports through callback props', async ({ page }) => {
    const byOne = page.locator('[data-step-counter="By one"]');
    const byFive = page.locator('[data-step-counter="By five"]');

    await byOne.getByRole('button', { name: '+1' }).click();
    await byOne.getByRole('button', { name: '+1' }).click();
    await byFive.getByRole('button', { name: '+5' }).click();
    await expect(byOne.locator('[data-counter-value]')).toHaveText('2');
    await expect(byFive.locator('[data-counter-value]')).toHaveText('5');
    await expect(page.locator('#reported-count')).toHaveText('2');

    await page.locator('#tags-click').click();
    await expect(page.locator('#tile-live [data-count]')).toHaveText('1');
    await expect(byOne.locator('[data-counter-value]')).toHaveText('2');
    await expect(byFive.locator('[data-counter-value]')).toHaveText('5');
  });

  test('swaps a class chosen at runtime', async ({ page }) => {
    await expect(page.locator('[data-note="info"]')).toBeVisible();
    await page.locator('#note-toggle').click();
    await expect(page.locator('[data-note="warning"]')).toBeVisible();
    await expect(page.locator('[data-note="info"]')).toHaveCount(0);
  });
});
