import { test, expect } from '@playwright/test';

test.describe('Docs Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/docs');
  });

  test('should render MDX content', async ({ page }) => {
    const main = page.locator('main.mdx-content');
    await expect(main.getByRole('heading', { level: 1, name: 'Welcome to Cossack Docs' })).toBeVisible();
    await expect(main.getByRole('listitem').filter({ hasText: 'File-based routing' })).toContainText(
      'Create routes from files in the pages directory.',
    );
    await expect(main.locator('strong', { hasText: 'Real-time updates' })).toBeVisible();
  });

  test('should display frontmatter title', async ({ page }) => {
    const title = await page.title();

    expect(title).toContain('Documentation');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      'Learn how to use the Cossack Framework.',
    );
  });

  test('should render markdown headings', async ({ page }) => {
    const headings = page.locator('h1, h2, h3');
    const count = await headings.count();

    expect(count).toBeGreaterThanOrEqual(4);
    await expect(page.locator('#welcome-to-cossack-docs')).toBeVisible();
    await expect(page.locator('#contents + ul a[href="#key-features"]')).toBeVisible();
  });

  test('should render markdown code blocks', async ({ page }) => {
    const codeBlocks = page.locator('pre, code');
    const count = await codeBlocks.count();

    expect(count).toBeGreaterThanOrEqual(2);
    await expect(page.locator('code[data-sh-language="bash"]')).toBeVisible();
    await expect(page.locator('.sh__token--identifier').first()).toBeVisible();
    await expect(page.locator('.sh__line--highlighted')).toHaveCount(2);
    const highlightBackground = await page.locator('.sh__line--highlighted').first().evaluate(
      element => getComputedStyle(element).backgroundColor,
    );
    expect(highlightBackground).not.toBe('transparent');
    expect(highlightBackground).not.toBe('rgba(0, 0, 0, 0)');
    // `// highlight-next-line` is a directive, not rendered content.
    await expect(page.locator('.docs-container > main.mdx-content')).not.toContainText('highlight-next-line');
  });

  test('should apply layout to MDX content', async ({ page }) => {
    await expect(page.locator('.docs-container > main.mdx-content')).toBeVisible();
    await expect(page.locator('[data-docs-raw-html]')).toHaveText('Raw HTML remains available.');
  });
});
