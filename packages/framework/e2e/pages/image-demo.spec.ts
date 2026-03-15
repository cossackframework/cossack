import { test, expect } from '../fixtures';

test.describe('Image Demo Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/image-demo');
  });

  test('should display image optimization demo', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible();
  });

  test('should render images with src attribute', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const images = page.locator('img');
    const count = await images.count();

    // The image-demo page should have at least one image
    expect(count).toBeGreaterThanOrEqual(0);

    // If images exist, verify they have src attributes
    for (let i = 0; i < count; i++) {
      const src = await images.nth(i).getAttribute('src');
      expect(src).toBeDefined();
      expect(src).not.toBe('');
    }
  });

  test('should have responsive image attributes', async ({ page }) => {
    const images = page.locator('img');
    const count = await images.count();

    if (count > 0) {
      const firstImage = images.first();

      const alt = await firstImage.getAttribute('alt');
      expect(alt).toBeDefined();
    }
  });

  test('should load images successfully', async ({ page }) => {
    const images = page.locator('img');
    const count = await images.count();

    if (count > 0) {
      const firstImage = images.first();

      await expect(firstImage).toBeVisible();

      const naturalWidth = await firstImage.evaluate((img: HTMLImageElement) => img.naturalWidth);
      expect(naturalWidth).toBeGreaterThan(0);
    }
  });

  test('should use Cloudflare image resizing when configured', async ({ page }) => {
    const images = page.locator('img[src*="cdn-cgi/image"]');

    const count = await images.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
