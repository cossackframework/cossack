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

    expect(title).toContain('Documentation');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      'Learn how to use the Cossack Framework.',
    );
  });

  test('should render markdown headings', async ({ page }) => {
    await page.waitForLoadState('networkidle');

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
  });

  test('should apply layout to MDX content', async ({ page }) => {
    await expect(page.locator('.docs-container > main.mdx-content')).toBeVisible();
    await expect(page.locator('[data-docs-raw-html]')).toHaveText('Raw HTML remains available.');
  });

  test('should handle code blocks', async ({ page }) => {
    const codeBlocks = page.locator('pre, code');
    const count = await codeBlocks.count();

    expect(count).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.docs-container > main.mdx-content')).not.toContainText('highlight-next-line');
  });
});
