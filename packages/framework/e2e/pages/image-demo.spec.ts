import { test, expect } from '@playwright/test';

const SOURCE = 'https://images.unsplash.com/photo-1550989460-0adf9ea622e2?q=80&w=600&auto=format&fit=crop';

test.describe('Image Demo Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/image-demo');
  });

  test('renders the Image helper with dimensions, alt text and lazy loading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Image Optimization Demo' })).toBeVisible();
    const image = page.getByRole('img', { name: 'Demo Image' });
    await expect(image).toHaveClass(/demo-img/);
    await expect(image).toHaveAttribute('width', '600');
    await expect(image).toHaveAttribute('height', '400');
    await expect(image).toHaveAttribute('loading', 'lazy');
  });

  test('serves the original URL when no image provider is configured', async ({ page }) => {
    // The demo does not set VITE_COSSACK_IMAGE_PROVIDER, so no /cdn-cgi/image
    // rewrite must be applied.
    await expect(page.getByRole('img', { name: 'Demo Image' })).toHaveAttribute('src', SOURCE);
  });
});
