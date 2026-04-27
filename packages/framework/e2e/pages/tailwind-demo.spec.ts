import { test, expect } from '../fixtures';

test.describe('Tailwind Demo Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tailwind-demo');
  });

  test('should render with Tailwind classes in the DOM', async ({ page }) => {
    const h1 = page.locator('h1');
    await expect(h1).toHaveText('Tailwind CSS Demo');

    // Verify Tailwind classes are present in the DOM
    const card = page.locator('.bg-blue-50');
    expect(await card.count()).toBe(1);
    expect(await card.getAttribute('class')).toContain('rounded-lg');
  });

  test('should apply Tailwind utility styles', async ({ page }) => {
    const h1 = page.locator('h1');
    const fontSize = await h1.evaluate((el) => getComputedStyle(el).fontSize);
    // text-3xl → 1.875rem (30px)
    expect(parseFloat(fontSize)).toBeGreaterThanOrEqual(28);

    const fontWeight = await h1.evaluate((el) => getComputedStyle(el).fontWeight);
    // font-bold → 700
    expect(fontWeight).toBe('700');
  });

  test('should have responsive grid layout', async ({ page }) => {
    const grid = page.locator('.grid');
    const display = await grid.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe('grid');
  });

  test('should handle interactive counter', async ({ page }) => {
    const counter = page.locator('[data-testid="counter-value"]');
    await expect(counter).toHaveText('0');

    const btn = page.locator('[data-testid="increment-btn"]');
    await btn.click();
    await expect(counter).toHaveText('1');

    await btn.click();
    await expect(counter).toHaveText('2');
  });

  test('should render badges with rounded-full', async ({ page }) => {
    const badge = page.locator('.rounded-full').first();
    const borderRadius = await badge.evaluate((el) => parseFloat(getComputedStyle(el).borderRadius));
    // rounded-full → very large value (Tailwind 4.x uses calc(infinity * 1px))
    expect(borderRadius).toBeGreaterThan(9999);
  });

  test('should preserve styles after client-side navigation', async ({ page }) => {
    // Verify initial page has Tailwind content
    const h1 = page.locator('h1');
    await expect(h1).toHaveText('Tailwind CSS Demo');

    // Navigate away using a link in the Layout sidebar
    await page.click('a[href="/"]');
    await page.waitForLoadState('networkidle');

    // Navigate back to tailwind-demo
    await page.goto('/tailwind-demo');
    await page.waitForLoadState('networkidle');

    // Verify Tailwind classes are still present after navigation
    const h1After = page.locator('h1');
    await expect(h1After).toHaveText('Tailwind CSS Demo');

    const card = page.locator('.bg-blue-50');
    expect(await card.count()).toBe(1);
  });
});
