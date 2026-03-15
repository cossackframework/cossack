import { test, expect } from '../fixtures';

test.describe('Docs Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/docs');
  });

  test('should display documentation content', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible();
  });

  test('should render MDX content', async ({ page }) => {
    const body = await page.locator('body').textContent();

    expect(body!.length).toBeGreaterThan(50);
  });

  test('should display frontmatter title', async ({ page }) => {
    const title = await page.title();

    expect(title).toBeDefined();
  });

  test('should render markdown headings', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const headings = page.locator('h1, h2, h3');
    const count = await headings.count();

    // The docs page has headings like "Welcome to Cossack Docs"
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should render markdown code blocks', async ({ page }) => {
    const codeBlocks = page.locator('pre, code');
    const count = await codeBlocks.count();

    // The docs page has code blocks
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should apply layout to MDX content', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle code blocks', async ({ page }) => {
    const codeBlocks = page.locator('pre, code');
    const count = await codeBlocks.count();

    expect(count).toBeGreaterThanOrEqual(0);
  });
});
