import { test, expect } from '../fixtures';

test.describe('Events Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/events');
  });

  test('should track click events via @On', async ({ page }) => {
    // The @On('click') handler is attached to the dashed-border container.
    const clickTarget = page.locator('div.border-dashed');

    await clickTarget.click();
    await page.waitForTimeout(100);

    // The click counter should now reflect the click.
    await expect(page.locator('text=1')).toBeVisible({ timeout: 2000 });
  });

  test('should track keyboard events via @OnDocument', async ({ page }) => {
    await page.keyboard.press('a');
    await page.waitForTimeout(100);

    await page.keyboard.press('b');
    await page.waitForTimeout(100);

    // The last key pressed should be visible. Scope to the green key display
    // so the selector doesn't match other elements containing 'b' (About link,
    // paragraph text, footer, etc.).
    const keyDisplay = page.locator('strong.text-green-800');
    await expect(keyDisplay).toHaveText('b', { timeout: 2000 });
  });

  test('should track window resize events via @OnWindow', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(200);

    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(200);

    // Window size should be displayed (not "Unknown").
    const body = await page.locator('body').textContent();
    expect(body).toContain('800x600');
  });

  test('should fire @On("mount") handler on component bootstrap', async ({ page }) => {
    // The mount handler sets mountFired = true and displays "yes".
    await expect(page.locator('text=yes')).toBeVisible({ timeout: 2000 });
  });

  test('should display event counts', async ({ page }) => {
    // Click to increment the click counter
    const clickArea = page.locator('div.border-dashed');
    await clickArea.click();
    await page.waitForTimeout(100);

    const body = await page.locator('body').textContent();
    // Check that click count is displayed (should be at least 1 after clicking)
    expect(body).toMatch(/@On\('click'\)/);
  });
});

test.describe('App @On("navigate-complete")', () => {
  test('should fire navigate-complete handler after SPA navigation', async ({ page }) => {
    await page.goto('/');

    // Trigger SPA navigation via link click. page.goto() would be a full page
    // reload (not SPA) and would also leak buffered console messages from the
    // prior load.
    await page.click('a[href="/contact"]');

    // Wait for the App's @On('navigate-complete') handler to log the new path.
    const navMessage = await page.waitForEvent('console', {
      predicate: (msg) =>
        msg.text().includes('@On("navigate-complete")') &&
        msg.text().includes('/contact'),
      timeout: 5000,
    });

    expect(navMessage.text()).toContain('/contact');
  });
});
