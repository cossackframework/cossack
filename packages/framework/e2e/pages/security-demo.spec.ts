import { test, expect } from '../fixtures';

test.describe('Security Demo (transitive preservation regression)', () => {
  let strippingErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    strippingErrors = [];
    // Fail loudly if the security plugin stripped a helper that onMount depends on.
    page.on('console', (msg) => {
      if (msg.type() === 'error') strippingErrors.push(msg.text());
    });
    page.on('pageerror', (err) => strippingErrors.push(String(err)));

    await page.goto('/security-demo');
    await page.waitForLoadState('networkidle');
  });

  test.afterEach(() => {
    for (const e of strippingErrors) {
      if (e.includes('stripped from the client bundle')) {
        throw new Error(`Unexpected stripping error in console: ${e}`);
      }
    }
  });

  test('setupReveal helper is preserved and runs on mount', async ({ page }) => {
    // The deterministic signal: setupReveal() flips revealReady, which sets
    // the data-reveal-ready attribute. If the security plugin incorrectly
    // stripped setupReveal(), onMount would throw and this attribute would
    // never appear.
    const demo = page.locator('.security-demo');
    await expect(demo).toHaveAttribute('data-reveal-ready', '', { timeout: 5000 });
  });

  test('revealed class is added when reveal elements scroll into view', async ({ page }) => {
    // Confirm setupReveal wired up the IntersectionObserver correctly.
    const demo = page.locator('.security-demo');
    await expect(demo).toHaveAttribute('data-reveal-ready', '', { timeout: 5000 });

    const reveal1 = page.getByTestId('reveal-1');
    await reveal1.scrollIntoViewIfNeeded();
    await expect(reveal1).toHaveClass(/revealed/, { timeout: 5000 });
  });

  test('each reveal element is revealed independently', async ({ page }) => {
    const demo = page.locator('.security-demo');
    await expect(demo).toHaveAttribute('data-reveal-ready', '', { timeout: 5000 });

    const reveal2 = page.getByTestId('reveal-2');
    await reveal2.scrollIntoViewIfNeeded();
    await expect(reveal2).toHaveClass(/revealed/, { timeout: 5000 });

    const reveal3 = page.getByTestId('reveal-3');
    await reveal3.scrollIntoViewIfNeeded();
    await expect(reveal3).toHaveClass(/revealed/, { timeout: 5000 });
  });
});
