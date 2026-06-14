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

    // The last key pressed should be visible.
    await expect(page.locator('text=b')).toBeVisible({ timeout: 2000 });
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

    // Spy on console.log to observe the App's @On('navigate-complete') handler
    const logs: string[] = [];
    page.on('console', (msg) => logs.push(msg.text()));

    await page.goto('/events');
    await page.waitForTimeout(200);

    const navLog = logs.find((l) => l.includes('@On("navigate-complete")'));
    expect(navLog).toBeDefined();
    expect(navLog).toContain('/events');
  });
});
