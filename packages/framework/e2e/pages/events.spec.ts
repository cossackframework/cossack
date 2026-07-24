import { test, expect } from '../fixtures';

test.describe('Events Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/events');
    await page.waitForFunction(
      () => (window as typeof window & { __cossackReady?: boolean }).__cossackReady === true,
    );
  });

  test('should track click events via @On', async ({ page }) => {
    // The @On('click') handler is attached to the dashed-border container.
    const clickTarget = page.locator('div.border-dashed');
    const counter = page.locator('div.border-dashed strong.text-blue-800');

    // Initially the counter reads 0.
    await expect(counter).toHaveText('0');

    await clickTarget.click();

    // The click counter should now reflect the click.
    await expect(counter).toHaveText('1');
  });

  test('should track keyboard events via @OnDocument', async ({ page }) => {
    await page.keyboard.press('a');
    await page.keyboard.press('b');

    // The last key pressed should be visible. Scope to the green key display
    // so the selector doesn't match other elements containing 'b' (About link,
    // paragraph text, footer, etc.).
    const keyDisplay = page.locator('strong.text-green-800');
    await expect(keyDisplay).toHaveText('b');
  });

  test('should track window resize events via @OnWindow', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.setViewportSize({ width: 800, height: 600 });

    // Window size should be displayed (not "Unknown").
    await expect(page.locator('strong.text-orange-800')).toHaveText('800x600');
  });

  test('should fire @On("mount") handler on component bootstrap', async ({ page }) => {
    // The mount handler sets mountFired = true and displays "yes".
    await expect(page.getByText('yes', { exact: true })).toBeVisible();
  });

  test('should display event counts', async ({ page }) => {
    // Click to increment the click counter
    const clickArea = page.locator('div.border-dashed');
    const counter = page.locator('div.border-dashed strong.text-blue-800');
    await clickArea.click();

    await expect(counter).toHaveText('1');
  });
});

test.describe('App @On("navigate-complete")', () => {
  test('should fire navigate-complete handler after SPA navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => (window as typeof window & { __cossackReady?: boolean }).__cossackReady === true,
    );

    // Trigger SPA navigation via link click. page.goto() would be a full page
    // reload (not SPA) and would also leak buffered console messages from the
    // prior load.
    // Register before clicking so a fast navigation cannot emit the message
    // before Playwright starts listening.
    const navMessagePromise = page.waitForEvent('console', {
      predicate: (msg) =>
        msg.text().includes('@On("navigate-complete")') &&
        msg.text().includes('/contact'),
      timeout: 5000,
    });
    await page.locator('a[href="/contact"]').first().click();
    const navMessage = await navMessagePromise;

    expect(navMessage.text()).toContain('/contact');
  });
});
